#!/usr/bin/env python3
"""Offline API fakes. Run with python3 iterm2/test_reorder.py."""

import asyncio
import contextlib
import importlib.util
import os
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("reorder", Path(__file__).with_name("reorder.py"))
reorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reorder)


def tab(name, source=None, connection=None):
    return NS(tab_id=name, sessions=[NS(session_id=source or name)],
              tmux_connection_id=connection,
              tmux_window_id="@1" if connection else None)


class Window:
    def __init__(self, name, tabs):
        self.window_id = name
        self.tabs = tabs
        self.moves = []

    async def async_set_tabs(self, tabs):
        self.moves.append([item.tab_id for item in tabs])
        self.tabs = tabs


class API:
    def __init__(self):
        self.original = [tab(str(i), "source" if i == 4 else None) for i in range(1, 8)]
        self.window = Window("native", self.original[:])
        self.other = Window("other", [tab("other-tab")])
        self.windows = [self.window, self.other]
        self.buried_sessions = []
        self.connections = []
        self.steps = []
        self.ready = False
        self.transaction = False
        self.refreshes = 0

    async def async_get_app(self, _connection):
        return self

    async def async_refresh(self):
        self.refreshes += 1
        if self.ready and self.steps:
            self.steps.pop(0)()

    async def async_get_tmux_connections(self, _connection):
        assert not self.transaction, "tmux discovery is forbidden in transactions"
        return self.connections[:]

    @contextlib.asynccontextmanager
    async def Transaction(self, _connection):
        assert not self.transaction
        self.transaction = True
        try:
            yield
        finally:
            self.transaction = False

    def send(self, text):
        assert text == "READY"
        assert self.refreshes >= 2
        assert not self.transaction
        self.ready = True

    def launch(self, owner="source", destination=None, bury=True):
        assert self.ready, "tmux must not launch before readiness"
        self.connections = [NS(connection_id="owned", owning_session=NS(session_id=owner))]
        if bury:
            self.bury()
        (destination or self.window).tabs.append(tab("new", connection="owned"))

    def bury(self):
        self.buried_sessions = [NS(session_id="source")]
        self.window.tabs = [item for item in self.window.tabs if item.tab_id != "4"]


class MonitorTests(unittest.IsolatedAsyncioTestCase):
    async def run_monitor(self, api, timeout=0.05, lock=lambda _: contextlib.nullcontext()):
        await reorder.monitor(api, None, "source", api, timeout=timeout, interval=0,
                              lock=lock)

    async def test_seven_tabs_fourth_origin(self):
        api = API()
        api.steps = [api.launch]
        await self.run_monitor(api)
        self.assertEqual(api.window.moves, [["1", "2", "3", "new", "5", "6", "7"]])
        self.assertEqual(api.other.moves, [])
        self.assertEqual(reorder.tab_ids(api.other), ["other-tab"])

    async def test_waits_for_burial(self):
        api = API()
        def bury_later():
            self.assertEqual(api.window.moves, [])
            api.bury()
        api.steps = [lambda: api.launch(bury=False), bury_later]
        await self.run_monitor(api)
        self.assertEqual(len(api.window.moves), 1)

    async def test_wrong_connection_ignored(self):
        api = API()
        api.steps = [lambda: api.launch(owner="someone-else")]
        with self.assertRaisesRegex(reorder.Stop, "timed out"):
            await self.run_monitor(api, timeout=0.01)
        self.assertEqual(api.window.moves, [])

    async def test_timeout(self):
        api = API()
        with self.assertRaisesRegex(reorder.Stop, "timed out"):
            await self.run_monitor(api, timeout=0.01)
        self.assertTrue(api.ready)
        self.assertEqual(api.window.moves, [])

    async def test_missing_origin_before_readiness(self):
        api = API()
        api.window.tabs = []
        with self.assertRaisesRegex(reorder.Stop, "origin session"):
            await self.run_monitor(api)
        self.assertFalse(api.ready)

    async def test_no_cross_window_move(self):
        api = API()
        api.steps = [lambda: api.launch(destination=api.other)]
        with self.assertRaisesRegex(reorder.Stop, "another window"):
            await self.run_monitor(api)
        self.assertEqual(api.window.moves + api.other.moves, [])

    async def test_concurrent_tab_reorder(self):
        api = API()
        def changed():
            api.launch()
            api.window.tabs[0], api.window.tabs[1] = api.window.tabs[1], api.window.tabs[0]
        api.steps = [changed]
        with self.assertRaisesRegex(reorder.Stop, "tab order changed"):
            await self.run_monitor(api)
        self.assertEqual(api.window.moves, [])

    async def test_user_moves_new_tab(self):
        api = API()
        def changed():
            api.launch()
            api.window.tabs.insert(0, api.window.tabs.pop())
        api.steps = [changed]
        with self.assertRaisesRegex(reorder.Stop, "new tab position changed"):
            await self.run_monitor(api)
        self.assertEqual(api.window.moves, [])

    async def test_origin_disappears_before_ready(self):
        api = API()
        refresh = api.async_refresh
        async def disappearing_refresh():
            await refresh()
            if api.refreshes == 2:
                api.window.tabs = []
        api.async_refresh = disappearing_refresh
        with self.assertRaisesRegex(reorder.Stop, "origin session"):
            await self.run_monitor(api)
        self.assertFalse(api.ready)

    async def test_unrelated_new_tab_not_moved(self):
        api = API()
        def changed():
            api.launch()
            api.window.tabs.append(tab("unrelated"))
        api.steps = [changed]
        with self.assertRaisesRegex(reorder.Stop, "multiple tabs"):
            await self.run_monitor(api)
        self.assertEqual(api.window.moves, [])

    async def test_original_window_closed(self):
        api = API()
        api.steps = [lambda: api.windows.remove(api.window)]
        with self.assertRaisesRegex(reorder.Stop, "window disappeared"):
            await self.run_monitor(api)
        self.assertEqual(api.other.moves, [])

    async def test_origin_disappears(self):
        api = API()
        api.steps = [lambda: setattr(api.window, "tabs", api.original[:3] + api.original[4:])]
        with self.assertRaisesRegex(reorder.Stop, "session disappeared"):
            await self.run_monitor(api)
        self.assertEqual(api.window.moves, [])

    async def test_existing_tmux_tab_not_moved(self):
        api = API()
        api.other.tabs.append(tab("existing", connection="owned"))
        api.steps = [api.launch]
        await self.run_monitor(api)
        self.assertEqual(api.other.moves, [])
        self.assertEqual(reorder.tab_ids(api.other), ["other-tab", "existing"])

    async def test_other_window_activity_allowed(self):
        api = API()
        def launch():
            api.other.tabs.insert(0, tab("unrelated"))
            api.launch()
        api.steps = [launch]
        await self.run_monitor(api)
        self.assertEqual(api.other.moves, [])

    async def test_competing_monitor_not_ready(self):
        api = API()
        with tempfile.TemporaryDirectory() as directory:
            from unittest.mock import patch
            with patch.object(reorder.tempfile, "gettempdir", return_value=directory):
                with reorder.window_lock("native"):
                    with self.assertRaisesRegex(reorder.Stop, "another reorder"):
                        await self.run_monitor(api, lock=reorder.window_lock)
        self.assertFalse(api.ready)


class LifecycleTests(unittest.TestCase):
    def test_uses_sdk_dispatcher(self):
        connection = object()
        calls = []

        def run_until_complete(callback, retry):
            calls.append(retry)
            asyncio.run(callback(connection))

        sdk = NS(run_until_complete=run_until_complete)
        with patch.dict(reorder.sys.modules, {"iterm2": sdk}), \
                patch.object(reorder, "monitor", new_callable=AsyncMock) as monitor, \
                patch.object(reorder.signal, "signal"), \
                patch.object(reorder.signal, "setitimer"):
            self.assertEqual(reorder.main(["w0t3p0:source", "unused-fifo"]), 0)
            self.assertEqual(calls, [False])
            self.assertEqual(monitor.await_args.args[:3], (sdk, connection, "source"))


class ReadinessTests(unittest.TestCase):
    def test_fifo_ready_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "ready")
            os.mkfifo(path, 0o600)
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            try:
                ready = reorder.Readiness(path)
                ready.send("READY")
                ready.send("FAIL")
                self.assertEqual(os.read(fd, 100), b"READY\n")
            finally:
                os.close(fd)

    def test_reject_regular_file(self):
        with tempfile.NamedTemporaryFile() as file:
            with self.assertRaises(reorder.Stop):
                reorder.Readiness(file.name).send("READY")

    def test_reject_public_fifo(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "ready")
            os.mkfifo(path, 0o600)
            os.chmod(path, 0o644)
            with self.assertRaises(reorder.Stop):
                reorder.Readiness(path).send("READY")


if __name__ == "__main__":
    unittest.main()
