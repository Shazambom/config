#!/usr/bin/env python3
"""Offline acknowledgement checks; no GUI or clipboard access."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('journey', Path(__file__).with_name('journey.py'))
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)


class AcknowledgementTests(unittest.IsolatedAsyncioTestCase):
    async def test_latest_match_does_not_decode_old_history(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            rows = [dict(id=str(i)) for i in range(1000)] + [dict(id='wanted')]
            (folder / 'events.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
            with patch.object(journey.json, 'loads', wraps=json.loads) as decode:
                result = await journey.wait_event(folder, lambda row: row['id'] == 'wanted')
            self.assertEqual(result, {'id': 'wanted'})
            self.assertEqual(decode.call_count, 1)

    async def test_latest_matching_record_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            rows = [dict(id='wanted', value=1), dict(id='wanted', value=2), dict(id='other')]
            (folder / 'events.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
            result = await journey.wait_event(folder, lambda row: row['id'] == 'wanted')
            self.assertEqual(result, {'id': 'wanted', 'value': 2})


if __name__ == '__main__':
    unittest.main()
