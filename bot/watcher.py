import logging
import re

import discord

import bootstrap
import bookmarks
import exporter
import scanner

logger = logging.getLogger(__name__)
client = bootstrap.get_client()

BOT_MENTION_RE = re.compile(r'@bot\s+(.*)', re.IGNORECASE)


# @client.event
# async def on_raw_message_edit(payload: discord.RawMessageUpdateEvent) -> None:
#     channel = client.get_channel(payload.channel_id)
#     if not isinstance(channel, discord.Thread):
#         return
#     if channel.id != payload.message_id:
#         return  # not the thread starter
#     content = (payload.data or {}).get("content", "")
#     strategy = parse_strategy(content)
#     if strategy:
#         logger.info("Thread starter edited with strategy: %s", strategy)
#         # TODO: trigger thread rescan with strategy

@client.event
async def on_message(message: discord.Message) -> None:
    if message.author.bot:
        return

    channel = message.channel
    parent = None

    if isinstance(channel, discord.Thread):
        parent = channel.parent
        source_channel = channel
    elif isinstance(channel, discord.TextChannel):
        source_channel = channel
    else:
        return

    # Verify this channel belongs to a tracked category
    category = getattr(source_channel, "category", None) or getattr(parent, "category", None)
    if category is None:
        return

    bookmark = bookmarks.load(message.guild.id, category.id)
    if bookmark is None:
        return

    links = scanner.process_message(message, source_channel, parent)
    if not links:
        bookmarks.set_cursor(bookmark, channel.id, message.id)
        bookmarks.save(message.guild.id, bookmark)
        return

    for link in links:
        logger.debug("Live hit %s in #%s: %s", link.platform, link.channel_name, link.url)

    bookmarks.touch_sync(bookmark)
    bookmarks.set_cursor(bookmark, channel.id, message.id)
    path = bookmarks.save(message.guild.id, bookmark)
    export_path = exporter.export_links(
        message.guild.id,
        category.id,
        links,
        output_dir=bootstrap.get_out(),
    )
    logger.info("Live export: %s (%d links)", export_path, len(links))


def parse_strategy(content: str) -> dict | None:
    """Extract @bot declaration from a thread starter message."""
    if not content:
        return None
    m = BOT_MENTION_RE.search(content)
    if not m:
        return None
    # TODO: parse album, lyrics-*, named parts
    return {"raw": m.group(1).strip()}


async def fetch_thread_strategy(thread: discord.Thread) -> dict | None:
    """Fetch thread starter and parse any @bot strategy declaration."""
    try:
        starter = await thread.parent.fetch_message(thread.id)
        return parse_strategy(starter.content)
    except discord.NotFound:
        return None
