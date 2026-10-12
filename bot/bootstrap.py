import logging
import logging.config
import os
from typing import Generator
from pathlib import Path

import discord
import dotenv
import yaml

OUT_DIR = "ARTIFACTS_DIR"
TOKEN = "DISCORD_BOT_TOKEN"
EXPECTED_ENV = {OUT_DIR, TOKEN}  # All of .env will load but these are demanded

_client: discord.Client | None = None


def _load_required() -> Generator[str]:
    for k in EXPECTED_ENV:
        if os.getenv(k) is not None:
            yield k


def load_env() -> None:
    with open("logging.yml") as f:
        logging.config.dictConfig(yaml.safe_load(f))

    dotenv.load_dotenv()
    found = set(_load_required())
    if found != EXPECTED_ENV:
        raise RuntimeError(f"Missing env: {sorted(EXPECTED_ENV - found)}")


def get_out() -> str:
    return Path(os.getenv(OUT_DIR))


def get_token() -> str:
    if token := os.getenv(TOKEN):
        return token
    _err(TOKEN)


def _err(name: str, e: Exception):
    raise RuntimeError(
        f"{name} environment variable is not set."
        " Create a .env file or export the variable before running."
    ) from e


def get_client() -> discord.Client:
    global _client
    if _client is None:
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.guild_messages = True
        _client = discord.Client(intents=intents)
    return _client
