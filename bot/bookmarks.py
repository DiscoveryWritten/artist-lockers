"""
Per-guild bookmark files under _data/{guild_id}/bookmarks.json.

Schema:
{
  "<category_id>": {
    "guild_id": "1234567890123456780",
    "category_id": "1234567890123456781",
    "category_name": "Music Locker",
    "last_sync": "2026-05-22T14:30:00Z",   # null if never synced
    "channels": {
      "987654321": null,                     # init'd, not yet scanned
      "111222333": "1234567890123456789"     # scanned to this message snowflake
    }
  }
}

Merge strategy: existing keys are never deleted, cursors only advance.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional, TypedDict

import discord

import bootstrap

logger = logging.getLogger(__name__)

OUT_DIR = bootstrap.get_out()


class Bookmarks(TypedDict):
    guild_id: str
    category_id: str
    category_name: str
    last_sync: Optional[str]

    # channel_id -> message_id snowflake or None
    channels: dict[str, Optional[str]]


CategoryStore = dict[int, Bookmarks]
GuildStore = dict[int, CategoryStore]
_store: GuildStore = {}


# Internal

def _bookmark_path(guild_id: int) -> Path:
    return OUT_DIR / f"{guild_id}/bookmarks.json"


def _ensure_loaded(guild_id: int) -> None:
    """Lazy-load all category bookmarks for a guild into memory."""
    if guild_id in _store:
        return
    _store[guild_id] = {}
    path = _bookmark_path(guild_id)
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        raw: dict[str, Bookmarks] = json.load(f)
    _store[guild_id] = {int(k): v for k, v in raw.items()}


# Public Interface

def load(guild_id: int, category_id: int) -> Optional[Bookmarks]:
    """Return the in-memory bookmark for a category, or None if untracked."""
    _ensure_loaded(guild_id)
    return _store[guild_id].get(category_id)


def save(guild_id: int, data: Bookmarks) -> Path:
    """Write a single category bookmark into the guild file."""
    category_id = int(data["category_id"])
    _store.setdefault(guild_id, {})[category_id] = data
    return flush(guild_id)


def flush(guild_id: int) -> Path:
    """Flush the full CategoryStore for a guild to its bookmarks.json."""
    path = _bookmark_path(guild_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    store = _store.get(guild_id, {})
    serializable = {str(k): v for k, v in store.items()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    logger.debug(
        "Flushed bookmarks for guild %d (%d categories)",
        guild_id, len(store)
    )
    return path


def flush_all() -> None:
    """Flush all guilds."""
    for guild_id in _store:
        flush(guild_id)


def all_tracked(guild_id: int) -> Iterator[tuple[int, Bookmarks]]:
    """Yield (category_id, bookmark) for all tracked categories in a guild."""
    _ensure_loaded(guild_id)
    yield from _store[guild_id].items()


def find_category_for_channel(guild_id: int, channel_id: int) -> Optional[int]:
    """Return the category_id that owns this channel, or None if untracked."""
    _ensure_loaded(guild_id)
    key = str(channel_id)
    for category_id, bookmark in _store[guild_id].items():
        if key in bookmark["channels"]:
            return category_id
    return None


def make_stub(guild_id: int, category: discord.CategoryChannel) -> Bookmarks:
    """Build a fresh bookmark stub from a live category object."""
    return Bookmarks(
        guild_id=str(guild_id),
        category_id=str(category.id),
        category_name=category.name,
        last_sync=None,
        channels={
            str(ch.id): None
            for ch in category.channels
            if isinstance(ch, (discord.TextChannel, discord.ForumChannel))
        },
    )


def merge_stub(
    existing: Bookmarks, category: discord.CategoryChannel
) -> Bookmarks:
    """
    Merge a fresh stub into an existing bookmark.
    Adds new channels, never removes or resets cursors, updates category_name.
    """
    existing["category_name"] = category.name
    channels = existing.setdefault("channels", {})
    for ch in category.channels:
        if isinstance(ch, (discord.TextChannel, discord.ForumChannel)):
            key = str(ch.id)
            if key not in channels:
                channels[key] = None
    return existing


def init_category(guild_id: int, category: discord.CategoryChannel) -> Path:
    """
    Create or update the bookmark stub for a category.
    Safe to run multiple times — only adds, never removes or resets.
    """
    existing = load(guild_id, category.id)
    if existing is None:
        data = make_stub(guild_id, category)
        logger.info("Created new bookmark stub for '%s'", category.name)
    else:
        data = merge_stub(existing, category)
        logger.info(
            "Merged bookmark stub for '%s' (%d channels)",
            category.name,
            len(data["channels"]),
        )
    return save(guild_id, data)


def get_cursor(bookmark: Bookmarks, channel_id: int) -> Optional[int]:
    """
    Return the stored message_id cursor for a channel, or None if unscanned.
    """
    raw = bookmark["channels"].get(str(channel_id))
    return int(raw) if raw is not None else None


def set_cursor(bookmark: Bookmarks, channel_id: int, message_id: int) -> None:
    """Advance a channel's cursor. Only moves forward, never back."""
    key = str(channel_id)
    current = bookmark["channels"].get(key)
    if current is None or message_id > int(current):
        bookmark["channels"][key] = str(message_id)


def touch_sync(bookmark: Bookmarks) -> None:
    """Update the last_sync timestamp to now."""
    bookmark["last_sync"] = datetime.now(timezone.utc).isoformat()
