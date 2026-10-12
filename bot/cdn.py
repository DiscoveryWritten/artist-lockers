"""
Utilities for Discord CDN attachment URLs.

Discord CDN attachment URLs contain signed query parameters:
  ex   — expiration time as hex unix seconds
  is   — issued-at time as hex unix seconds
  hm   — HMAC signature

Example:
  https://cdn.discordapp.com/attachments/123/456/file.mp3?ex=6617a3f0&is=...&hm=...
"""

import re
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
from typing import Optional

_CDN_HOST_RE = re.compile(r"cdn\.discordapp\.com", re.IGNORECASE)


def is_cdn_url(url: str) -> bool:
    return bool(_CDN_HOST_RE.search(url))


def expiry(url: str) -> Optional[datetime]:
    """Return the expiration datetime from a Discord CDN URL, or None if absent."""
    qs = parse_qs(urlparse(url).query)
    ex = qs.get("ex", [None])[0]
    if ex is None:
        return None
    try:
        return datetime.fromtimestamp(int(ex, 16), tz=timezone.utc)
    except (ValueError, OverflowError):
        return None


def is_expired(url: str, now: Optional[datetime] = None) -> bool:
    """Return True if the CDN URL has expired."""
    exp = expiry(url)
    if exp is None:
        return False
    return (now or datetime.now(timezone.utc)) >= exp


def expires_within(url: str, seconds: float, now: Optional[datetime] = None) -> bool:
    """Return True if the CDN URL expires within the given number of seconds."""
    exp = expiry(url)
    if exp is None:
        return False
    _now = now or datetime.now(timezone.utc)
    return (_now >= exp) or ((exp - _now).total_seconds() <= seconds)
