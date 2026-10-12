from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class MediaHit:
    """Uniform carrier for a media hit regardless of source (url/embed/attachment)."""

    url: str
    platform: str
    source_type: str  # "url" | "embed" | "attachment"

    # Embed metadata
    embed_title: Optional[str] = None
    embed_description: Optional[str] = None
    embed_provider: Optional[str] = None
    embed_author: Optional[str] = None
    embed_thumbnail_url: Optional[str] = None

    # Attachment metadata
    attachment_filename: Optional[str] = None
    attachment_content_type: Optional[str] = None
    attachment_size: Optional[int] = None
    attachment_width: Optional[int] = None
    attachment_height: Optional[int] = None


@dataclass
class FoundLink:
    """A media link found in a Discord message, with full context for deep-linking."""

    # The link itself
    url: str
    platform: str
    source_type: str  # "url" | "embed" | "attachment"

    # Message context
    message_id: int
    message_content: str
    message_timestamp: datetime
    author_id: int
    author_name: str

    # Channel context
    channel_id: int
    channel_name: str
    channel_type: str  # "text" | "forum_post" | "thread"

    # Parent context (forum channel or category)
    parent_channel_id: Optional[int] = None
    parent_channel_name: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None

    # Guild
    guild_id: int = 0
    guild_name: str = ""

    # Embed metadata
    embed_title: Optional[str] = None
    embed_description: Optional[str] = None
    embed_provider: Optional[str] = None
    embed_author: Optional[str] = None
    embed_thumbnail_url: Optional[str] = None

    # Attachment metadata
    attachment_filename: Optional[str] = None
    attachment_content_type: Optional[str] = None
    attachment_size: Optional[int] = None
    attachment_width: Optional[int] = None
    attachment_height: Optional[int] = None

    @property
    def deep_link(self) -> str:
        """Discord web deep link to the exact message."""
        return (
            "https://discord.com/channels/"
            f"{self.guild_id}/{self.channel_id}/{self.message_id}"
        )

    @property
    def label(self) -> str:
        """Best available human-readable label for this hit."""
        return (
            self.embed_title
            or self.attachment_filename
            or self.url
        )

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "platform": self.platform,
            "source_type": self.source_type,
            "label": self.label,
            "deep_link": self.deep_link,
            "message": {
                "id": str(self.message_id),
                "content": self.message_content,
                "timestamp": self.message_timestamp.isoformat(),
                "author_id": str(self.author_id),
                "author_name": self.author_name,
            },
            "channel": {
                "id": str(self.channel_id),
                "name": self.channel_name,
                "type": self.channel_type,
            },
            "parent_channel": {
                "id": str(self.parent_channel_id) if self.parent_channel_id else None,
                "name": self.parent_channel_name,
            },
            "category": {
                "id": str(self.category_id) if self.category_id else None,
                "name": self.category_name,
            },
            "guild": {
                "id": str(self.guild_id),
                "name": self.guild_name,
            },
            "embed": {
                "title": self.embed_title,
                "description": self.embed_description,
                "provider": self.embed_provider,
                "author": self.embed_author,
                "thumbnail_url": self.embed_thumbnail_url,
            } if self.source_type == "embed" else None,
            "attachment": {
                "filename": self.attachment_filename,
                "content_type": self.attachment_content_type,
                "size": self.attachment_size,
                "width": self.attachment_width,
                "height": self.attachment_height,
            } if self.source_type == "attachment" else None,
        }
