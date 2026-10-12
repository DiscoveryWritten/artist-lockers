import re
import logging
from typing import AsyncIterator, Optional

import discord

import bookmarks
from models import FoundLink, MediaHit

logger = logging.getLogger(__name__)

DOMAINS = ["suno", "udio", "youtube", "soundcloud", "spotify"]
DOMAIN_RE = r"https?://(?:[\w-]+\.)*(?:{0})\.[a-z]+/\S+"  # umm

# flake8: noqa: E731
_re_domain = lambda s: re.compile(DOMAIN_RE.format(s), re.IGNORECASE)
COMBINED_PATTERN = _re_domain('|'.join(DOMAINS))
PLATFORM_PATTERNS: dict[str, re.Pattern] = {
    name: _re_domain(name)
    for name in DOMAINS
}

# MIME prefixes that indicate audio or video attachments
MEDIA_MIME_PREFIXES = ("audio/", "video/")


def _detect_platform(url: str) -> Optional[str]:
    for platform, pattern in PLATFORM_PATTERNS.items():
        if pattern.search(url):
            return platform
    return None


def _extract_urls(text: str) -> list[MediaHit]:
    """Extract URL hits from message text content as MediaHit objects."""
    return [
        MediaHit(url=url, platform=_detect_platform(url) or "unknown", source_type="url")
        for url in COMBINED_PATTERN.findall(text)
    ]


def _extract_media(message: discord.Message) -> list[MediaHit]:
    """
    Extract MediaHit objects from message attachments and embeds.
    Attachments: audio/* or video/* MIME types.
    Embeds: any embed with a video field, or whose URL matches a known domain.
    """
    hits: list[MediaHit] = []

    for attachment in message.attachments:
        ct = attachment.content_type or ""
        if ct.startswith(MEDIA_MIME_PREFIXES):
            hits.append(MediaHit(
                url=attachment.url,
                platform="discord_cdn",
                source_type="attachment",
                attachment_filename=attachment.filename,
                attachment_content_type=ct,
                attachment_size=attachment.size,
                attachment_width=getattr(attachment, "width", None),
                attachment_height=getattr(attachment, "height", None),
            ))

    for embed in message.embeds:
        url = embed.url or ""
        if embed.video and embed.video.url:
            url = embed.video.url
        if not url:
            continue
        platform = _detect_platform(url) or ("embed" if embed.video else None)
        if not platform:
            continue
        hits.append(MediaHit(
            url=url,
            platform=platform,
            source_type="embed",
            embed_title=embed.title or None,
            embed_description=embed.description or None,
            embed_provider=embed.provider.name if embed.provider else None,
            embed_author=embed.author.name if embed.author else None,
            embed_thumbnail_url=embed.thumbnail.url if embed.thumbnail else None,
        ))

    return hits


def _channel_type_label(channel: discord.abc.GuildChannel | discord.Thread) -> str:
    if isinstance(channel, discord.Thread):
        return "forum_post" if isinstance(channel.parent, discord.ForumChannel) else "thread"
    if isinstance(channel, discord.ForumChannel):
        return "forum"
    return "text"


def _build_found_link(
    hit: MediaHit,
    message: discord.Message,
    channel: discord.abc.GuildChannel | discord.Thread,
    parent: Optional[discord.abc.GuildChannel] = None,
) -> FoundLink:
    guild = message.guild
    category = getattr(channel, "category", None) or (
        getattr(parent, "category", None) if parent else None
    )

    return FoundLink(
        url=hit.url,
        platform=hit.platform,
        source_type=hit.source_type,
        message_id=message.id,
        message_content=message.content,
        message_timestamp=message.created_at,
        author_id=message.author.id,
        author_name=str(message.author),
        channel_id=channel.id,
        channel_name=channel.name,
        channel_type=_channel_type_label(channel),
        parent_channel_id=parent.id if parent else None,
        parent_channel_name=parent.name if parent else None,
        category_id=category.id if category else None,
        category_name=category.name if category else None,
        guild_id=guild.id if guild else 0,
        guild_name=guild.name if guild else "",
        embed_title=hit.embed_title,
        embed_description=hit.embed_description,
        embed_provider=hit.embed_provider,
        embed_author=hit.embed_author,
        embed_thumbnail_url=hit.embed_thumbnail_url,
        attachment_filename=hit.attachment_filename,
        attachment_content_type=hit.attachment_content_type,
        attachment_size=hit.attachment_size,
        attachment_width=hit.attachment_width,
        attachment_height=hit.attachment_height,
    )


def _has_new_messages(
    channel: discord.abc.GuildChannel | discord.Thread,
    cursor: Optional[int],
) -> bool:
    """
    Cheap pre-filter using Discord's cached last_message_id.
    If cursor is None (never scanned), always proceed.
    If last_message_id is unavailable, assume there may be new content.
    """
    if cursor is None:
        return True
    last = getattr(channel, "last_message_id", None)
    if last is None:
        return True
    return last > cursor


def process_message(
    message: discord.Message,
    source_channel: discord.abc.GuildChannel | discord.Thread,
    parent: Optional[discord.abc.GuildChannel] = None,
) -> list[FoundLink]:
    """Extract all FoundLinks from a single message. Empty list if none."""
    all_hits: list[MediaHit] = (
        (_extract_urls(message.content) if message.content else [])
        + _extract_media(message)
    )
    return [
        _build_found_link(hit, message, source_channel, parent)
        for hit in all_hits
    ]


async def scan_messages(
    channel: discord.abc.Messageable,
    source_channel: discord.abc.GuildChannel | discord.Thread,
    cursor: Optional[int] = None,
    parent: Optional[discord.abc.GuildChannel] = None,
) -> AsyncIterator[tuple[FoundLink, int]]:
    after = discord.Object(id=cursor) if cursor is not None else None
    try:
        async for message in channel.history(
            limit=None, oldest_first=True, after=after
        ):
            links = process_message(message, source_channel, parent)
            for link in links:
                yield link, message.id
            yield None, message.id
    except discord.Forbidden:
        logger.warning("No permission to read %s", getattr(source_channel, "name", source_channel))
    except discord.HTTPException as e:
        logger.error("HTTP error reading %s: %s", getattr(source_channel, "name", source_channel), e)


async def scan_text_channel(
    channel: discord.TextChannel,
    bookmark: dict,
    set_cursor_fn,
) -> AsyncIterator[FoundLink]:
    """Scan a text channel and its threads, respecting and advancing cursors."""
    channel_cursor = _get_cursor_from_bookmark(bookmark, channel.id)

    if _has_new_messages(channel, channel_cursor):
        async for link, msg_id in scan_messages(channel, channel, cursor=channel_cursor):
            set_cursor_fn(channel.id, msg_id)
            if link:
                yield link
    else:
        logger.debug("  Skipping #%s (no new messages)", channel.name)

    # Active threads
    try:
        for thread in channel.threads:
            async for link in _scan_thread(thread, parent=channel, bookmark=bookmark, set_cursor_fn=set_cursor_fn):
                yield link
    except discord.Forbidden:
        logger.warning("Cannot list threads in %s", channel.name)

    # Archived threads
    try:
        async for thread in channel.archived_threads(limit=None):
            async for link in _scan_thread(thread, parent=channel, bookmark=bookmark, set_cursor_fn=set_cursor_fn):
                yield link
    except discord.Forbidden:
        logger.warning("Cannot list archived threads in %s", channel.name)


async def scan_forum_channel(
    forum: discord.ForumChannel,
    bookmark: dict,
    set_cursor_fn,
) -> AsyncIterator[FoundLink]:
    """Scan all active and archived forum posts, respecting and advancing cursors."""
    try:
        for thread in forum.threads:
            async for link in _scan_thread(thread, parent=forum, bookmark=bookmark, set_cursor_fn=set_cursor_fn):
                yield link
    except discord.Forbidden:
        logger.warning("Cannot list posts in forum %s", forum.name)

    try:
        async for thread in forum.archived_threads(limit=None):
            async for link in _scan_thread(thread, parent=forum, bookmark=bookmark, set_cursor_fn=set_cursor_fn):
                yield link
    except discord.Forbidden:
        logger.warning("Cannot list archived posts in forum %s", forum.name)


async def _scan_thread(
    thread: discord.Thread,
    parent: discord.abc.GuildChannel,
    bookmark: dict,
    set_cursor_fn,
) -> AsyncIterator[FoundLink]:
    """Scan a single thread, lazily registering it in the bookmark if new."""
    thread_cursor = _get_cursor_from_bookmark(bookmark, thread.id)

    if not _has_new_messages(thread, thread_cursor):
        logger.debug("    Skipping thread '%s' (no new messages)", thread.name)
        return

    async for link, msg_id in scan_messages(thread, thread, cursor=thread_cursor, parent=parent):
        set_cursor_fn(thread.id, msg_id)
        if link:
            yield link


def _get_cursor_from_bookmark(bookmark: dict, channel_id: int) -> Optional[int]:
    raw = bookmark["channels"].get(str(channel_id))
    return int(raw) if raw is not None else None


async def scan_category(
    category: discord.CategoryChannel,
    bookmark: dict,
    set_cursor_fn,
) -> AsyncIterator[FoundLink]:
    """Scan all text and forum channels in a category using bookmark cursors."""
    logger.info("Scanning category: %s (%d channels)", category.name, len(category.channels))
    for channel in category.channels:
        if isinstance(channel, discord.TextChannel):
            logger.info("  Text channel: #%s", channel.name)
            async for link in scan_text_channel(channel, bookmark, set_cursor_fn):
                yield link
        elif isinstance(channel, discord.ForumChannel):
            logger.info("  Forum channel: #%s", channel.name)
            async for link in scan_forum_channel(channel, bookmark, set_cursor_fn):
                yield link
        else:
            logger.debug("  Skipping unsupported channel type: %s", type(channel).__name__)


async def sync_guild(
    guild: discord.Guild,
) -> tuple[list[FoundLink], Path]:
    """Scan all tracked categories for a guild. Returns links found and bookmark path."""
    tracked = dict(bookmarks.all_tracked(guild.id))
    if not tracked:
        logger.warning("No tracked categories for guild '%s'", guild.name)
        return [], None

    found_links = []

    for category in guild.categories:
        if category.id not in tracked:
            continue

        bookmark = tracked[category.id]

        def set_cursor(channel_id: int, message_id: int) -> None:
            bookmarks.set_cursor(bookmark, channel_id, message_id)
            key = str(channel_id)
            if key not in bookmark["channels"]:
                bookmark["channels"][key] = None

        async for link in scan_category(category, bookmark, set_cursor):
            found_links.append(link)
            logger.debug("Found %s in #%s: %s", link.platform, link.channel_name, link.url)

        bookmarks.touch_sync(bookmark)

    path = bookmarks.flush(guild.id)
    return found_links, path
