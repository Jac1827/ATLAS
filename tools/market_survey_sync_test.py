from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("market_survey_sync.py")
spec = importlib.util.spec_from_file_location("market_sync", MODULE_PATH)
market_sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(market_sync)


class MarketSurveySyncTests(unittest.TestCase):
    def test_manual_forwarding_is_workspace_independent_and_keeps_dry_run(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "config with spaces.json"
            config.write_text("{}")
            args = argparse.Namespace(config=config, dry_run=True, lookback_days=4, limit=75)
            with patch.object(market_sync, "parse_args", return_value=args), patch.object(market_sync.subprocess, "run", return_value=SimpleNamespace(returncode=7)) as run:
                self.assertEqual(market_sync.main(), 7)
                argv = run.call_args.args[0]
                self.assertEqual(argv[1], str(market_sync.WORKSPACE / "tools" / "outlook_dashboard_sync.py"))
                self.assertEqual(argv[argv.index("--config") + 1], str(config.resolve()))
                self.assertEqual(argv[-1], "--dry-run")
                self.assertEqual(run.call_args.kwargs, {"cwd": market_sync.WORKSPACE, "check": False})

    def test_post_update_commands_cannot_launch_an_import(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "config.json"
            config.write_text(json.dumps({"post_update_commands": [["unexpected-import"]]}))
            args = argparse.Namespace(config=config, dry_run=False, lookback_days=3, limit=100)
            with patch.object(market_sync, "parse_args", return_value=args), patch.object(market_sync.subprocess, "run") as run:
                with self.assertRaisesRegex(SystemExit, "cannot run post-update commands"):
                    market_sync.main()
                run.assert_not_called()

    def test_missing_config_cannot_launch_downloader(self):
        args = argparse.Namespace(config=Path("missing-test-config.json"), dry_run=False, lookback_days=3, limit=100)
        with patch.object(market_sync, "parse_args", return_value=args), patch.object(market_sync.subprocess, "run") as run:
            with self.assertRaisesRegex(SystemExit, "Config not found"):
                market_sync.main()
            run.assert_not_called()

    def test_cli_defaults_and_invalid_ranges(self):
        with patch.object(market_sync.sys, "argv", [str(MODULE_PATH)]):
            args = market_sync.parse_args()
        self.assertEqual((args.lookback_days, args.limit, args.dry_run), (3, 100, False))
        self.assertEqual(args.config, market_sync.WORKSPACE / "tools" / "market_survey_sync.config.json")
        for option, value in [("--lookback-days", "-1"), ("--limit", "0")]:
            with patch.object(market_sync.sys, "argv", [str(MODULE_PATH), option, value]), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    market_sync.parse_args()

    def test_template_is_download_only_and_rejects_unsafe_attachment_paths(self):
        config = json.loads(MODULE_PATH.with_name("market_survey_sync.config.example.json").read_text())
        self.assertEqual(config["post_update_commands"], [])
        self.assertEqual(config["mailbox_user"], "your.name@example.com")
        pattern = re.compile(config["rules"][0]["attachment_name_regex"], re.IGNORECASE)
        self.assertTrue(pattern.search("2026_09_20_12_08_RISE_Florence_Villa_Market.xlsx"))
        for name in ["2026_09_20_12_08_RISE_../../evil_Market.xlsx", "2026_09_20_12_08_RISE_..\\evil_Market.xlsx", "/tmp/2026_09_20_12_08_RISE_A_Market.xlsx", "2026_09_20_12_08_RISE_A_Market.pdf"]:
            self.assertIsNone(pattern.search(name), name)


if __name__ == "__main__":
    unittest.main()
