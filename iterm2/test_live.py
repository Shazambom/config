#!/usr/bin/env python3
"""Exercise the launcher in an isolated iTerm2 window and private tmux server."""

import argparse
import asyncio
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

import iterm2


async def exercise(connection, position, keep):
    repo = Path(__file__).resolve().parent.parent
    work = Path(tempfile.mkdtemp(prefix="pi-iterm-live-"))
    socket = str(work / "tmux.sock")
    tmux = shutil.which("tmux")
    if not tmux:
        raise RuntimeError("tmux is required")
    app = await iterm2.async_get_app(connection)
    await app.async_refresh()
    original_windows = {w.window_id: [t.tab_id for t in w.tabs] for w in app.windows}
    previous = app.current_terminal_window
    window_id = None
    try:
        fixture = work / "repo"
        for directory in (fixture / "pi", fixture / "iterm2", work / "bin"):
            directory.mkdir(parents=True)
        shutil.copy2(repo / "pi.sh", fixture / "pi.sh")
        shutil.copy2(repo / "pi/command-path.sh", fixture / "pi/command-path.sh")
        for name in ("launch.sh", "reorder.py"):
            shutil.copy2(repo / "iterm2" / name, fixture / "iterm2" / name)
        launch = fixture / "iterm2/launch.sh"
        launch.write_text(launch.read_text().replace("</dev/null 3>&- &", "</dev/null 3>&- 2>" + shlex.quote(str(work / "helper.log")) + " &"))
        for name in ("runtime.sh", "jq.sh"):
            (fixture / "pi" / name).write_text("")
        scripts = {
            fixture / "init.sh": "#!/bin/bash\nexit 0\n",
            work / "bin/pi": "#!/bin/bash\nprintf 'Portable Pi placement test. No model calls.\\n'\nread -r finish\n",
            work / "bin/tmux": "#!/bin/bash\nexec " + shlex.quote(tmux) + " -S " + shlex.quote(socket) + ' -f /dev/null "$@"\n',
        }
        for path, text in scripts.items():
            path.write_text(text)
            path.chmod(0o700)
        profile = iterm2.LocalWriteOnlyProfile({"Initial Text": ""})
        profile.set_name("Portable Pi placement test")
        profile.set_use_custom_command(iterm2.Profile.USE_CUSTOM_COMMAND_ENABLED)
        profile.set_command("/bin/bash --noprofile --norc")
        window = await iterm2.Window.async_create(connection, profile_customizations=profile)
        if window is None:
            raise RuntimeError("test window exited before capture")
        window_id = window.window_id
        (work / "window-id").write_text(window_id)
        for _ in range(6):
            await window.async_create_tab(profile_customizations=profile)
        await app.async_refresh()
        window = app.get_window_by_id(window_id)
        before = [tab.tab_id for tab in window.tabs]
        assert len(before) == 7, "test must start with seven tabs"
        origin = window.tabs[position - 1]
        assert len(origin.sessions) == 1, "test origin must have one session"
        source = origin.sessions[0]
        await origin.async_activate()
        command = "unset TMUX TMUX_PANE CONFIG_PI_HOME; "
        command += "TERM_PROGRAM=iTerm.app ITERM_SESSION_ID=" + shlex.quote(source.session_id)
        command += " PATH=" + shlex.quote(str(work / "bin") + ":" + os.environ["PATH"])
        command += " " + shlex.quote(str(fixture / "pi.sh")) + "\n"
        await source.async_send_text(command, suppress_broadcast=True)
        deadline = asyncio.get_running_loop().time() + 30
        while asyncio.get_running_loop().time() < deadline:
            await app.async_refresh()
            window = app.get_window_by_id(window_id)
            assert window is not None, "test window disappeared"
            candidates = [tab for tab in window.tabs if tab.tab_id not in before and tab.tmux_connection_id]
            if len(candidates) == 1 and not any(tab.tab_id == origin.tab_id for tab in window.tabs):
                after = [tab.tab_id for tab in window.tabs]
                expected = before[:]
                expected[position - 1] = candidates[0].tab_id
                if after == expected:
                    for identifier, order in original_windows.items():
                        untouched = app.get_window_by_id(identifier)
                        assert untouched and [tab.tab_id for tab in untouched.tabs] == order, "an existing window changed"
                    print("PASS: live iTerm2 seven-tab launch replaced tab {} in place; other tabs/windows unchanged.".format(position))
                    return
            await asyncio.sleep(0.1)
        log = work / "helper.log"
        if log.exists():
            print(log.read_text())
        else:
            print("No helper log: launcher did not start the helper.")
        print("Test window tab count:", len(window.tabs), "new tmux tab count:", len(candidates))
        raise AssertionError("native tmux tab did not replace tab {} within 30 seconds".format(position))
    finally:
        if keep:
            print("Debug window retained; fixture: {} ; tmux socket: {}".format(work, socket))
        else:
            subprocess.run([tmux, "-S", socket, "kill-server"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            await app.async_refresh()
            if window_id:
                owned = app.get_window_by_id(window_id)
                if owned:
                    await owned.async_close(force=True)
            shutil.rmtree(work)
            if previous and app.get_window_by_id(previous.window_id):
                await previous.async_activate()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", type=int, choices=range(1, 8), default=4)
    parser.add_argument("--keep", action="store_true", help="leave the test window and private fixture for inspection")
    args = parser.parse_args()

    async def run(connection):
        await exercise(connection, args.position, args.keep)

    iterm2.run_until_complete(run, retry=False)


if __name__ == "__main__":
    main()
