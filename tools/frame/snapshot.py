"""Record the TV's Art Mode settings (brightness, colour tone, sleep and motion options) and
which mats are in use, so they can be compared or re-applied after a reset or firmware update.
The TV must be in Art Mode.

  snapshot.py    writes docs/art-settings-snapshot.json
"""
from __future__ import annotations

import asyncio
import sys
import time
from collections import Counter

from artws import ArtChannel, ArtError, mats_of
from tv import ROOT, write_json


async def run() -> int:
    snapshot: dict = {"taken_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    async with ArtChannel() as art:
        if not await art.art_mode_on():
            print("The art service is not answering. Switch the TV to Art Mode (short press on power) and run this again.")
            return 1
        try:
            snapshot["art_settings"] = {s.get("item"): s.get("value") for s in await art.settings()}
        except ArtError as exc:
            snapshot["art_settings"] = {"error": str(exc)}
        show = await art.slideshow()
        images = await art.known_images()
        snapshot["slideshow"] = {"running": show["running"], "minutes": show["minutes"], "category_id": show["category_id"], "type": show["type"], "images": len(show["items"])}
        snapshot["images_listed"] = len(images)
        snapshot["landscape_mats"] = dict(Counter(mats_of(i)[0] for i in images))
        snapshot["portrait_mats"] = dict(Counter(mats_of(i)[1] for i in images))
    out = ROOT / "docs" / "art-settings-snapshot.json"
    write_json(out, snapshot)
    print(f"saved {out.relative_to(ROOT)}: {snapshot['art_settings']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(run()))
    except ArtError as exc:
        sys.exit(str(exc))
