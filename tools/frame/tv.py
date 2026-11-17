"""Shared helpers for the frame tools: where the TV is and how to reach its art controls."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKEN_DIR = Path(__file__).resolve().parent / ".tokens"
TOKEN_FILE = TOKEN_DIR / "tv-token.txt"
TV_FILE = ROOT / ".tv.json"
LOOK_FILE = ROOT / "frame-look.json"
PRIVATE_DIR = ROOT / "docs" / "private"

# Own uploads have content ids starting with "MY". The category is no guide: Art Store images
# also turn up under MY-C0008, the recently shown list.


def tv_ip() -> str:
    if not TV_FILE.exists():
        sys.exit("No .tv.json yet. Turn the TV on and run: node tools/find-tv.mjs")
    return json.loads(TV_FILE.read_text())["ip"]


def connect(timeout: float = 10):
    """The TV on port 8002. The pairing token stays in tools/frame/.tokens/ (gitignored)."""
    from samsungframetv import SamsungTVWS

    TOKEN_DIR.mkdir(exist_ok=True)
    return SamsungTVWS(host=tv_ip(), port=8002, token_file=str(TOKEN_FILE), timeout=timeout, name="Frame Home")


def is_own(item: dict) -> bool:
    return str(item.get("content_id", "")).startswith("MY")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
