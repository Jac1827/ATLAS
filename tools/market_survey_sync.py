#!/usr/bin/env python3
"""Manually download ApartmentIQ workbooks for a separate reviewed ATLAS upload."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = WORKSPACE / "tools" / "market_survey_sync.config.json"


def nonnegative(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be zero or greater")
    return number


def positive(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download recent ApartmentIQ Excel attachments for a separate manual ATLAS upload."
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="Local mailbox config JSON path.")
    parser.add_argument("--dry-run", action="store_true", help="Read matching emails without saving attachments or importing data.")
    parser.add_argument("--lookback-days", type=nonnegative, default=3, help="Recent days to inspect (default: 3).")
    parser.add_argument("--limit", type=positive, default=100, help="Maximum recent messages to inspect (default: 100).")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = args.config.expanduser().resolve()
    if not config.is_file():
        raise SystemExit("Config not found. Copy tools/market_survey_sync.config.example.json to tools/market_survey_sync.config.json and set your mailbox.")
    settings = json.loads(config.read_text(encoding="utf-8"))
    if settings.get("post_update_commands"):
        raise SystemExit("Market survey downloads cannot run post-update commands. Keep post_update_commands empty and review uploads in ATLAS separately.")
    command = [
        sys.executable,
        str(WORKSPACE / "tools" / "outlook_dashboard_sync.py"),
        "--config", str(config),
        "--lookback-days", str(args.lookback_days),
        "--limit", str(args.limit),
    ]
    if args.dry_run:
        command.append("--dry-run")
    return subprocess.run(command, cwd=WORKSPACE, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
