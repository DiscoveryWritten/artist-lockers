#!/usr/bin/env python
"""
CLI entry point for the Discord media bot.

Usage:
    uv run bot sync                           # scan all tracked categories
    uv run bot sync --init "Category Regex$"  # create/merge bookmark stubs
"""

import logging
import sys
from pathlib import Path

# flake8: noqa: E402
sys.path.insert(0, str(Path(__file__).parent.parent / "bot"))

import bootstrap; bootstrap.load_env()
import commands

logger = logging.getLogger(__name__)


if __name__ == "__main__":
    commands.parse()
