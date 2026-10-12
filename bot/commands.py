import argparse
import asyncio
import logging
import re
import sys

import discord

import bookmarks
import bootstrap
import exporter
import refresh
import scanner


logger = logging.getLogger(__name__)
parser = argparse.ArgumentParser(
    prog="cli.py",
    description="Discord media link scanner",
)
subparsers = parser.add_subparsers(dest="command", required=True)


async def run_sync(args, client: discord.Client) -> None:
    if args.init:
        return await run_sync_init(args, client)

    await client.wait_until_ready()
    try:
        for guild in client.guilds:
            found_links, bookmark_path = await scanner.sync_guild(guild)
            if bookmark_path:
                logger.info("Bookmarks flushed: %s", bookmark_path)
            if found_links:
                export_path = exporter.export_links(
                    guild.id,
                    found_links,
                    output_dir=bootstrap.get_out(),
                )
                logger.info(
                    "Export written: %s (%d links)",
                    export_path, len(found_links)
                )
    finally:
        await client.close()


async def run_sync_init(args, client: discord.Client) -> None:
    try:
        pattern = re.compile(args.init)
    except re.error as e:
        logger.error("Invalid pattern '%s': %s", args.init, e)
        sys.exit(1)

    def match_categories(
        guild: discord.Guild, pattern: re.Pattern
    ) -> list[discord.CategoryChannel]:
        matched = [c for c in guild.categories if pattern.search(c.name)]
        if not matched:
            logger.warning(
                "No categories matching /%s/ in guild '%s'",
                pattern.pattern, guild.name
            )
        else:
            logger.info(
                "Matched %d categor%s in '%s': %s",
                len(matched),
                "y" if len(matched) == 1 else "ies",
                guild.name,
                [c.name for c in matched],
            )
        return matched

    await client.wait_until_ready()
    try:
        for guild in client.guilds:
            for category in match_categories(guild, pattern):
                path = bookmarks.init_category(guild.id, category)
                logger.info("Bookmark written: %s", path)
    finally:
        await client.close()


SYNC = "sync"
sync_parser = subparsers.add_parser(
    SYNC,
    help="Scan all tracked categories for media links"
)
sync_parser.add_argument(
    "--init",
    metavar="PATTERN",
    help="Create or update bookmark stubs for categories, no scanning",
)


async def run_refresh(args, client: discord.Client) -> None:
    await client.wait_until_ready()
    threshold_seconds = args.within * 3600
    output_dir = bootstrap.get_out()
    try:
        for guild in client.guilds:
            count = await refresh.refresh_guild(
                client, guild, threshold_seconds, output_dir
            )
            logger.info(
                "Guild '%s': %d attachment URL(s) refreshed", guild.name, count
            )
    finally:
        await client.close()


REFRESH = "refresh"
refresh_parser = subparsers.add_parser(
    REFRESH,
    help="Refresh expiring Discord CDN attachment URLs"
)
refresh_parser.add_argument(
    "--within",
    metavar="HOURS",
    type=float,
    default=24.0,
    help="Refresh URLs expiring within this many hours (default: 24)",
)


commands = {
    SYNC: run_sync,
    REFRESH: run_refresh,
}


def parse() -> None:
    args = parser.parse_args()

    try:
        token = bootstrap.get_token()
    except Exception:
        logger.error("DISCORD_BOT_TOKEN is not set. Use dotenv machinery.")
        raise

    cmd = commands[args.command]

    async def runner():
        async with client:
            await asyncio.gather(client.start(token), cmd(args, client))

    client = bootstrap.get_client()
    asyncio.run(runner())
