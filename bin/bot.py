#!/usr/bin/env python
"""
Discord media link scanner bot.

On startup, scans configured category IDs for media messages across
all text channels and forum posts, then exports results as JSON.
"""
import logging
import logging.config
import sys
from pathlib import Path

# flake8: noqa: E402
sys.path.insert(0, str(Path(__file__).parent.parent / "bot"))

import bootstrap
# import watcher

bootstrap.load_env()
logger = logging.getLogger(__name__)
client = bootstrap.get_client()


@client.event
async def on_ready():
    logger.info("Logged in as %s[id=%s]", client.user, client.user.id)


def main() -> None:
    client.run(bootstrap.get_token())


if __name__ == "__main__":
    main()
