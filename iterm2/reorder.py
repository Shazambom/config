#!/usr/bin/env python3
"""Restore one auto-buried tmux control tab's position using iTerm2's API."""

import asyncio
import contextlib
import fcntl
import hashlib
import os
import signal
import stat
import sys
import tempfile


class Stop(Exception):
    """A layout no longer permits a safe reorder."""


class Interrupted(BaseException):
    pass


@contextlib.contextmanager
def window_lock(window_id):
    # Keep the inode after unlocking so competing processes share one lock.
    directory = os.path.join(tempfile.gettempdir(), "iterm2-reorder-{}".format(os.getuid()))
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise Stop("unsafe lock directory")
    name = hashlib.sha256(window_id.encode()).hexdigest()
    fd = os.open(os.path.join(directory, name), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop("another reorder is watching this window") from None
        yield
    finally:
        os.close(fd)


class Readiness:
    def __init__(self, path):
        self.path = path
        self.sent = False

    def send(self, message):
        if self.sent:
            return
        info = os.lstat(self.path)
        if not stat.S_ISFIFO(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Stop("readiness path is not a private FIFO")
        fd = os.open(self.path, os.O_WRONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        try:
            actual = os.fstat(fd)
            if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
                raise Stop("readiness FIFO changed")
            os.write(fd, (message + "\n").encode("ascii"))
            self.sent = True
        finally:
            os.close(fd)


def tab_ids(window):
    return [tab.tab_id for tab in window.tabs]


def origin_location(app, source):
    matches = [(window, tab) for window in app.windows for tab in window.tabs
               if any(session.session_id == source for session in tab.sessions)]
    if len(matches) != 1:
        raise Stop("origin session is missing or ambiguous")
    window, tab = matches[0]
    if len(tab.sessions) != 1:
        raise Stop("origin tab contains split panes")
    return window, tab


async def monitor(api, connection, source, ready, timeout=18, interval=0.1,
                  lock=window_lock):
    app = await api.async_get_app(connection)
    await app.async_refresh()
    window, origin = origin_location(app, source)
    window_id, origin_id = window.window_id, origin.tab_id
    initial = tab_ids(window)
    index = initial.index(origin_id)
    survivors = [tab_id for tab_id in initial if tab_id != origin_id]
    known = {tab.tab_id for win in app.windows for tab in win.tabs}
    deadline = asyncio.get_running_loop().time() + timeout

    with lock(window_id):
        # Tmux connection discovery is forbidden inside a transaction.
        connections = await api.async_get_tmux_connections(connection)
        # Capture and validate again under the lock before letting tmux start.
        async with api.Transaction(connection):
            await app.async_refresh()
            current, tab = origin_location(app, source)
            if current.window_id != window_id or tab.tab_id != origin_id or tab_ids(current) != initial:
                raise Stop("origin layout changed before launch")
            if any(item.owning_session is not None and
                   item.owning_session.session_id == source for item in connections):
                raise Stop("origin already owns a tmux connection")
        ready.send("READY")
        saw_buried = False
        while asyncio.get_running_loop().time() < deadline:
            connections = await api.async_get_tmux_connections(connection)
            # Transactions freeze the UI through the final check and reorder.
            # Both layout refresh and reorder are synchronous server RPCs.
            async with api.Transaction(connection):
                await app.async_refresh()
                windows = [win for win in app.windows if win.window_id == window_id]
                if len(windows) != 1:
                    raise Stop("origin window disappeared")
                current = windows[0]
                ids = tab_ids(current)
                buried = any(session.session_id == source for session in app.buried_sessions)
                visible = any(session.session_id == source for win in app.windows
                              for tab in win.tabs for session in tab.sessions)
                if not buried and not visible:
                    raise Stop("origin session disappeared")
                if visible:
                    win, tab = origin_location(app, source)
                    if saw_buried or win.window_id != window_id or tab.tab_id != origin_id:
                        raise Stop("origin session moved")
                saw_buried = saw_buried or buried
                expected = survivors if buried else initial
                if [tab_id for tab_id in ids if tab_id in known] != expected:
                    raise Stop("tab order changed")
                new_tabs = [tab for tab in current.tabs if tab.tab_id not in known]
                if len(new_tabs) > 1:
                    raise Stop("multiple tabs opened")
                if new_tabs and ids != expected + [new_tabs[0].tab_id]:
                    raise Stop("new tab position changed")
                owned = [item.connection_id for item in connections
                         if item.owning_session is not None and
                         item.owning_session.session_id == source]
                if len(owned) > 1:
                    raise Stop("multiple tmux connections opened")
                candidates = [tab for win in app.windows for tab in win.tabs
                              if tab.tab_id not in known and
                              tab.tmux_connection_id in owned and tab.tmux_window_id is not None]
                if len(candidates) > 1:
                    raise Stop("multiple tmux tabs opened")
                if candidates and candidates[0] not in new_tabs:
                    raise Stop("tmux tab opened in another window")
                if candidates and buried:
                    candidate = candidates[0]
                    # iTerm must append the new tab. Any other position may be
                    # a user reorder, which must not be overwritten.
                    if ids != survivors + [candidate.tab_id]:
                        raise Stop("new tab position changed")
                    ordered = [tab for tab in current.tabs if tab.tab_id != candidate.tab_id]
                    ordered.insert(index, candidate)
                    if [tab.tab_id for tab in ordered] != ids:
                        await current.async_set_tabs(ordered)
                    return
            await asyncio.sleep(interval)
    raise Stop("timed out waiting for the tmux tab")


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2 or not args[0].split(":")[-1]:
        print("iterm2 reorder: expected ORIGIN_SESSION_ID READY_FIFO", file=sys.stderr)
        return 1
    source = args[0].split(":")[-1]
    ready = Readiness(args[1])

    def interrupt(_signum, _frame):
        raise Interrupted()

    for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGALRM):
        signal.signal(number, interrupt)
    signal.setitimer(signal.ITIMER_REAL, 20)
    failure = None
    try:
        # The upstream connection may print tracebacks. Never forward those or
        # authentication details; emit only our own bounded diagnostics.
        with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            import iterm2

            async def connected(connection):
                nonlocal failure
                try:
                    await monitor(iterm2, connection, source, ready)
                except Stop as error:
                    failure = str(error)
                except Exception:
                    failure = "API request failed"

            iterm2.run_until_complete(connected, retry=False)
    except Interrupted:
        failure = "interrupted or timed out"
    except (Exception, SystemExit):
        failure = "API connection or authorization failed"
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    if failure:
        try:
            ready.send("FAIL")
        except (OSError, Stop):
            pass
        print("iterm2 reorder: " + failure, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
