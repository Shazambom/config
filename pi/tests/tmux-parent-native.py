#!/usr/bin/env python3
"""Observe a private tmux -CC attachment through iTerm's supported Python API.

Called by test-tmux-parent.sh --native. Does not edit profiles or preferences.
Only the new control session and tabs belonging to its connection are owned.
"""
import asyncio
import json
from pathlib import Path
import shlex
import shutil
import sys
import subprocess
import time

import iterm2


async def exercise(connection, root):
    app = await iterm2.async_get_app(connection)
    await app.async_refresh()
    previous_window = app.current_terminal_window
    previous_session = (previous_window.current_tab.current_session
                        if previous_window and previous_window.current_tab else None)
    source = None
    owned_connection = None
    owned_tabs = set()
    failures = []

    def record(event, **fields):
        with (root / "native.jsonl").open("a") as out:
            out.write(json.dumps(dict(event=event, time=time.time(), **fields)) + "\n")

    async def restore_focus():
        await app.async_refresh()
        if previous_session:
            current = app.get_session_by_id(previous_session.session_id)
            if current:
                await current.async_activate()
                return
        if previous_window and app.get_window_by_id(previous_window.window_id):
            await app.get_window_by_id(previous_window.window_id).async_activate()

    async def owned_tab():
        nonlocal owned_connection
        # Ownership comes from the gateway, never a before/after connection diff.
        connections = await iterm2.async_get_tmux_connections(connection)
        matches = [item for item in connections if item.owning_session is not None
                   and item.owning_session.session_id == source.session_id]
        if len(matches) > 1:
            raise AssertionError("multiple connections owned by test control session")
        if matches:
            owned_connection = matches[0].connection_id
        await app.async_refresh()
        candidates = [tab for window in app.windows for tab in window.tabs
                      if owned_connection and tab.tmux_connection_id == owned_connection]
        owned_tabs.update(tab.tab_id for tab in candidates)
        if len(candidates) > 1:
            raise AssertionError("private server unexpectedly has multiple native tabs")
        return candidates[0] if candidates else None

    try:
        profile = iterm2.LocalWriteOnlyProfile({"Initial Text": ""})
        profile.set_name("Pi private tmux regression")
        profile.set_use_custom_command(iterm2.Profile.USE_CUSTOM_COMMAND_ENABLED)
        profile.set_command(shlex.quote(shutil.which("bash")) + " --noprofile --norc")
        window = await iterm2.Window.async_create(connection, profile_customizations=profile)
        if window is None:
            raise AssertionError("test control window exited")
        source = window.current_tab.current_session
        await source.async_set_grid_size(iterm2.Size(220, 60))
        record("control", session=source.session_id, window=window.window_id)
        command = "unset TMUX TMUX_PANE; " + shlex.quote(shutil.which("tmux"))
        command += " -S " + shlex.quote(str(root / "tmux.sock")) + " -CC attach-session -t proof\n"
        await source.async_send_text(command, suppress_broadcast=True)
        deadline = asyncio.get_running_loop().time() + 20
        tab = None
        while asyncio.get_running_loop().time() < deadline:
            tab = await owned_tab()
            if tab and len(tab.sessions) == 1:
                break
            await asyncio.sleep(0.1)
        if tab is None or len(tab.sessions) != 1:
            raise AssertionError("owned native tmux tab attachment timed out")
        parent_id = tab.sessions[0].session_id
        await tab.sessions[0].async_set_grid_size(iterm2.Size(220, 60))
        await asyncio.sleep(0.5)
        tab = await owned_tab()
        record("attached", connection=owned_connection, tab=tab.tab_id, parent=parent_id,
               current=tab.current_session.session_id if tab.current_session else None)
        # Keep the user's original session frontmost while observing this tab's
        # current_session independently. Do not reselect parent to mask focus bugs.
        await restore_focus()
        seen = set()
        last_current = None
        deadline = asyncio.get_running_loop().time() + 120
        while not (root / "native-stop").exists():
            if asyncio.get_running_loop().time() >= deadline:
                raise AssertionError("native monitor deadline")
            tab = await owned_tab()
            if tab is None:
                raise AssertionError("owned native tab disappeared")
            current = tab.current_session.session_id if tab.current_session else None
            if current != last_current:
                tmux_active = subprocess.check_output(
                    [shutil.which("tmux"), "-S", str(root / "tmux.sock"),
                     "display-message", "-p", "-t", "proof", "#{pane_id}"], text=True).strip()
                record("focus", current=current, parent=parent_id, tmux_active=tmux_active,
                       sessions=[s.session_id for s in tab.sessions])
                last_current = current
            if current != parent_id:
                issue = "native current_session moved away from parent"
                if issue not in failures:
                    failures.append(issue)
            phase_path = root / "native-phase"
            phase = phase_path.read_text() if phase_path.exists() else ""
            if phase and phase not in seen:
                screens = {}
                geometry = {}
                for session in tab.sessions:
                    screen = await session.async_get_screen_contents()
                    text = "\n".join(screen.line(i).string for i in range(screen.number_of_lines))
                    screens[session.session_id] = text
                    geometry[session.session_id] = dict(width=session.grid_size.width,
                                                       height=session.grid_size.height)
                (root / ("native-" + phase + "-screens.json")).write_text(json.dumps(screens, indent=2))
                record("snapshot", phase=phase, current=current, parent=parent_id,
                       sessions=list(screens), geometry=geometry)
                if phase == "running":
                    children = [text for sid, text in screens.items() if sid != parent_id]
                    for name in ("alpha", "beta"):
                        if not any("CHILD_" + name + "_" in text for text in children):
                            failures.append(name + " output not visible in native child while running")
                    if "DRAFT_during_children" not in screens.get(parent_id, ""):
                        failures.append("draft not visible in native parent")
                if phase == "released-alpha" and "mode=fullscreen" in (root / "launch.txt").read_text():
                    parent_screen = screens.get(parent_id, "")
                    if "HISTORY_000" not in parent_screen:
                        failures.append("native reading position lost on completion resize")
                    if "DRAFT_during_children_kept" not in parent_screen:
                        failures.append("native draft lost on completion resize")
                seen.add(phase)
                (root / ("native-ack-" + phase)).touch()
            await asyncio.sleep(0.1)
        if "finished" not in seen:
            failures.append("shell test stopped before native completion checks finished")
        record("result", failures=failures)
        if failures:
            raise AssertionError("; ".join(failures))
        print("PASS: native owned -CC tab focus, live child screens, draft and completion resize")
    finally:
        # Close only exact tabs tied to our gateway connection. Never close a
        # window: iTerm may have placed a tmux tab in an existing user window.
        try:
            await app.async_refresh()
            for window in app.windows:
                for tab in list(window.tabs):
                    if tab.tab_id in owned_tabs and tab.tmux_connection_id == owned_connection:
                        await tab.async_close(force=True)
            await app.async_refresh()
            if source:
                control = app.get_session_by_id(source.session_id)
                if control:
                    await control.async_close(force=True)
        finally:
            await restore_focus()
            # Close RPC acknowledgement precedes session-removal notifications.
            for _ in range(50):
                await app.async_refresh()
                remaining_tabs = [tab.tab_id for window in app.windows for tab in window.tabs
                                  if tab.tab_id in owned_tabs]
                remaining_control = source and app.get_session_by_id(source.session_id)
                if not remaining_tabs and not remaining_control:
                    break
                await asyncio.sleep(0.1)
            record("cleanup", control=source.session_id if source else None,
                   tabs=sorted(owned_tabs), remaining_tabs=remaining_tabs,
                   remaining_control=bool(remaining_control))
            if remaining_tabs or remaining_control:
                raise AssertionError("test-owned native sessions survived cleanup")


def main():
    root = Path(sys.argv[1]).resolve()
    failed = False

    async def run(connection):
        nonlocal failed
        try:
            await asyncio.wait_for(exercise(connection, root), timeout=150)
        except Exception as error:
            failed = True
            (root / "native-error").write_text(str(error))

    try:
        iterm2.run_until_complete(run, retry=False)
    except Exception:
        # Do not forward API authentication details from connection exceptions.
        failed = True
        (root / "native-error").write_text("iTerm API connection failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
