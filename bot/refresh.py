"""
Refresh expiring Discord CDN attachment URLs in refs.json files.

Reads each tracked category's refs.json, finds attachment records whose CDN
URLs are expired or expiring within the threshold, fetches the originating
message via the Discord API to get a fresh signed URL, and writes the updated
refs.json back in place.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import discord

import bookmarks
import cdn

logger = logging.getLogger(__name__)


def _refs_path(guild_id: int, category_id: int, output_dir: Path) -> Path:
    return output_dir / f"{guild_id}/{category_id}/refs.json"


def _find_fresh_url(
    attachments: list[discord.Attachment],
    filename: str,
) -> Optional[str]:
    """Match a fresh attachment URL by filename."""
    for attachment in attachments:
        if attachment.filename == filename:
            return attachment.url
    return None


async def refresh_guild(
    client: discord.Client,
    guild: discord.Guild,
    threshold_seconds: float,
    output_dir: Path,
) -> int:
    """
    Refresh expiring attachment URLs for all tracked categories in a guild.
    Returns the total number of URLs refreshed.
    """
    now = datetime.now(timezone.utc)
    total_refreshed = 0

    for category_id, bookmark in bookmarks.all_tracked(guild.id):
        refs_path = _refs_path(guild.id, category_id, output_dir)
        if not refs_path.exists():
            logger.debug("No refs.json for category %d, skipping", category_id)
            continue

        with open(refs_path, encoding="utf-8") as f:
            payload = json.load(f)

        links = payload.get("links", [])
        refreshed = 0
        dirty = False

        for entry in links:
            if entry.get("source_type") != "attachment":
                continue
            url = entry.get("url", "")
            if not cdn.expires_within(url, threshold_seconds, now):
                continue

            channel_id = int(entry["channel"]["id"])
            message_id = int(entry["message"]["id"])
            filename = (entry.get("attachment") or {}).get("filename")
            if not filename:
                logger.warning("No filename on attachment record %s, skipping", message_id)
                continue

            try:
                channel = client.get_channel(channel_id)
                if channel is None:
                    channel = await client.fetch_channel(channel_id)
                message = await channel.fetch_message(message_id)
            except discord.NotFound:
                logger.warning("Message %d not found (deleted?), skipping", message_id)
                continue
            except discord.Forbidden:
                logger.warning("No access to channel %d, skipping", channel_id)
                continue
            except discord.HTTPException as e:
                logger.error("HTTP error fetching message %d: %s", message_id, e)
                continue

            fresh_url = _find_fresh_url(message.attachments, filename)
            if fresh_url is None:
                logger.warning(
                    "Filename '%s' not found in message %d attachments", filename, message_id
                )
                continue

            old_expiry = cdn.expiry(url)
            new_expiry = cdn.expiry(fresh_url)
            logger.debug(
                "Refreshed '%s': %s -> %s",
                filename,
                old_expiry.isoformat() if old_expiry else "unknown",
                new_expiry.isoformat() if new_expiry else "unknown",
            )

            entry["url"] = fresh_url
            refreshed += 1
            dirty = True

        if dirty:
            payload["exported_at"] = datetime.now(timezone.utc).isoformat()
            with open(refs_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
            logger.info(
                "Refreshed %d URL(s) in %s", refreshed, refs_path
            )

        total_refreshed += refreshed

    return total_refreshed
