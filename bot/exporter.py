import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from models import FoundLink

logger = logging.getLogger(__name__)


def export_links(
    guild_id: str,
    category_id: str,
    links: list[FoundLink],
    output_dir: str | Path = ".",
) -> Path:
    """
    Export a list of FoundLink objects to a timestamped JSON file.
    Returns the path to the amended file.
    """
    output_path = Path(output_dir) / f"{guild_id}/{category_id}/refs.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists():
        with open(output_path, encoding="utf-8") as f:
            existing = json.load(f)
        index = {
            entry["message"]["id"]: entry
            for entry in existing.get("links", [])
        }
    else:
        index = {}

    for link in links:
        index[str(link.message_id)] = link.to_dict()

    merged = sorted(
        index.values(),
        key=lambda e: (e["channel"]["id"], e["message"]["timestamp"]),
    )

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "total_links": len(merged),
        "links": merged,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    logger.info(
        "refs.json updated: %d total links (%d new) at %s",
        len(merged), len(links), output_path
    )
    return output_path
