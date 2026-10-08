#!/usr/bin/env python3
"""Offline checks for native copy/paste profile policy."""
import importlib.util
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('reorder', Path(__file__).with_name('reorder.py'))
reorder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reorder)

class NativeSelectionTests(unittest.TestCase):
    def test_native_selection_preserves_wheel_and_unrelated_keys(self):
        original = {'Mouse Reporting': False, 'Keyboard Map': {
            '0x63-0x100000': {'Action': 11, 'Text': 'old-copy'},
            '0x76-0x100000-0x9': {'Action': 11, 'Text': 'old-paste'},
            '0x63-0x40000': {'Action': 0, 'Text': 'ctrl-c'},
            '0x7a-0x100000': {'Action': 11, 'Text': 'undo'},
        }}
        changes = reorder.native_selection_properties(original)
        self.assertIs(changes['Mouse Reporting'], True)
        self.assertIs(changes['Mouse Reporting allow mouse wheel'], True)
        self.assertIs(changes['Mouse Reporting allow clicks and drags'], False)
        self.assertEqual(set(changes['Keyboard Map']), {'0x63-0x40000', '0x7a-0x100000'})
        self.assertIn('0x63-0x100000', original['Keyboard Map'])
        self.assertEqual(reorder.native_selection_properties({**original, **changes}), {})

    def test_absent_map_stays_absent(self):
        changes = reorder.native_selection_properties({})
        self.assertNotIn('Keyboard Map', changes)

class ConfigurationTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self):
        saved = {'Keyboard Map': {'0x63-0x100000': {'Action': 11}}}
        profile = NS(name='tmux', guid='saved', all_properties=saved)
        profile.async_get_full_profile = AsyncMock(return_value=profile)
        def session():
            properties = {'Keyboard Map': {'0x76-0x100000': {'Action': 11}}}
            item = NS(properties=properties)
            item.async_get_profile = AsyncMock(side_effect=lambda: NS(all_properties=properties))
            item.async_set_profile_properties = AsyncMock(side_effect=properties.update)
            return item
        native, shell = session(), session()
        app = NS(async_refresh=AsyncMock(), windows=[NS(tabs=[
            NS(tmux_connection_id='native', sessions=[native]),
            NS(tmux_connection_id=None, sessions=[shell])])])
        async def save(_connection, session_id, assignments, guids):
            self.assertIsNone(session_id)
            self.assertEqual(guids, ['saved'])
            saved.update({key: json.loads(value) for key, value in assignments})
            return NS(set_profile_property_response=NS(status=0))
        api = NS(PartialProfile=NS(async_query=AsyncMock(return_value=[profile])),
                 rpc=NS(async_set_profile_properties_json=AsyncMock(side_effect=save)),
                 async_get_app=AsyncMock(return_value=app), LocalWriteOnlyProfile=lambda value: value)
        return api, saved, native, shell

    async def test_saved_defaults_existing_panes_and_idempotence(self):
        api, saved, native, shell = self.fixture()
        await reorder.configure_native_selection(api, None)
        self.assertEqual(reorder.native_selection_properties(saved), {})
        self.assertEqual(reorder.native_selection_properties(native.properties), {})
        self.assertFalse(shell.async_set_profile_properties.called)
        await reorder.configure_native_selection(api, None)
        self.assertEqual(api.rpc.async_set_profile_properties_json.await_count, 1)
        self.assertEqual(native.async_set_profile_properties.await_count, 1)

    async def test_rejected_save_does_not_mutate_live_panes(self):
        api, _saved, native, shell = self.fixture()
        api.rpc.async_set_profile_properties_json.side_effect = None
        api.rpc.async_set_profile_properties_json.return_value = NS(set_profile_property_response=NS(status=2))
        with self.assertRaises(reorder.Stop):
            await reorder.configure_native_selection(api, None)
        self.assertFalse(native.async_set_profile_properties.called)
        self.assertFalse(shell.async_set_profile_properties.called)

    async def test_missing_or_ambiguous_profile_is_loud(self):
        for profiles in ([], [NS(name='tmux'), NS(name='tmux')]):
            api, _saved, native, _shell = self.fixture()
            api.PartialProfile.async_query.return_value = profiles
            with self.assertRaises(reorder.Stop):
                await reorder.configure_native_selection(api, None)
            self.assertFalse(native.async_set_profile_properties.called)

if __name__ == '__main__': unittest.main()
