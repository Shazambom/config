#!/usr/bin/env python3
"""Offline safety checks only. These do not prove clipboard behavior."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

from native import rendered_expectation

ENTRY = Path(__file__).resolve().parents[2] / 'test-copy-paste-universal.sh'


class SafeDefault(unittest.TestCase):
    def test_without_both_flags_does_not_launch_live_dependencies(self):
        with tempfile.TemporaryDirectory(prefix='pi-universal-safety-') as directory:
            root = Path(directory)
            sentinel = root / 'CALLED'
            for name in ('tmux', 'node', 'jq', 'osascript', 'pbcopy', 'pbpaste', 'python3', 'uname'):
                spy = root / name
                spy.write_text('#!/bin/sh\nprintf called > "$SENTINEL"\nexit 91\n')
                spy.chmod(0o700)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], SENTINEL=str(sentinel))
            for args in ([], ['--live-manual'], ['--native-menu'], ['--candidate-profile'], ['--replace-clipboard'], ['--native-menu', '--candidate-profile'], ['--unknown']):
                result = subprocess.run([shutil.which('bash'), str(ENTRY), *args], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 77)
                self.assertIn('BLOCKED', result.stdout)
                self.assertFalse(sentinel.exists(), 'safe path called a live dependency')
            help_result = subprocess.run([shutil.which('bash'), str(ENTRY), '--help'], env=env, capture_output=True, text=True)
            self.assertEqual(help_result.returncode, 0)
            self.assertIn('WARNING', help_result.stdout)
            self.assertFalse(sentinel.exists())


class VisibleOracle(unittest.TestCase):
    def test_contiguous_selection_keeps_visible_second_line_gutter(self):
        expected, prefixes = rendered_expectation([' PI_SYNTHETIC      ', ' second line    '], 0, 1, 'PI_SYNTHETIC\nsecond line')
        self.assertEqual(expected, 'PI_SYNTHETIC\n second line')
        self.assertEqual(prefixes, [' ', ' '])

    def test_trailing_blank_line_preserves_newline_not_renderer_padding(self):
        expected, _ = rendered_expectation([' PI_SYNTHETIC  ', ' second line  ', '              '], 0, 1, 'PI_SYNTHETIC\nsecond line\n')
        self.assertEqual(expected, 'PI_SYNTHETIC\n second line\n')

    def test_rejects_unknown_prefix_or_changed_fixture(self):
        for rows in (['xPI_SYNTHETIC', ' second line'], [' PI_SYNTHETIC', ' wrong line']):
            with self.assertRaises(AssertionError):
                rendered_expectation(rows, 0, 1, 'PI_SYNTHETIC\nsecond line')
        with self.assertRaises(AssertionError):
            rendered_expectation([' PI_SYNTHETIC', ' not blank'], 0, 1, 'PI_SYNTHETIC\n')


if __name__ == '__main__':
    unittest.main()
