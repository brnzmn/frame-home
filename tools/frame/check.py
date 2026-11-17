"""Art-controls check. Read-only. The TV must be in Art Mode.

  check.py    what the TV reports: API version, mats, filters, settings, the slideshow, the images

Writes docs/private/art-check.json (not committed).

There is deliberately no write test here. A mat change cannot always be undone: the TV refuses
to set a portrait mat back to "none" (error -7), so a test that changes and restores can leave
an image altered. See docs/phase0-findings.md.
"""
from __future__ import annotations

import asyncio
import sys
import time
from collections import Counter

from artws import ArtChannel, ArtError, mats_of
from tv import PRIVATE_DIR, ROOT, write_json


async def run() -> int:
    report: dict = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    async with ArtChannel() as art:
        if not await art.art_mode_on():
            print("The art service is not answering. Switch the TV to Art Mode (short press on power) and run this again.")
            return 1

        async def step(name: str, call):
            try:
                report[name] = await call
            except ArtError as exc:
                report[name] = {"error": str(exc)}
            return report[name]

        await step("api_version", art.request("api_version"))
        styles, colours = await art.mats()
        report["mat_styles"], report["mat_colours"] = styles, colours
        await step("photo_filters", art.filters())
        await step("art_settings", art.settings())
        current = await art.request("get_current_artwork")
        report["current"] = {k: current.get(k) for k in ("content_id", "category_id", "content_type")}
        show = await art.slideshow()
        items = await art.known_images()
        report["slideshow"] = {"running": show["running"], "minutes": show["minutes"], "category_id": show["category_id"], "images": len(show["items"])}
        report["images"] = {
            "listed": len(items),
            "landscape_mats": dict(Counter(mats_of(i)[0] for i in items)),
            "portrait_mats": dict(Counter(mats_of(i)[1] for i in items)),
        }

    out = PRIVATE_DIR / "art-check.json"
    write_json(out, report)
    version = report["api_version"].get("version") if isinstance(report["api_version"], dict) else report["api_version"]
    print(f"art API {version}; {len(styles)} mat styles, {len(colours)} colours")
    print(f"current artwork: {report['current']}")
    print(f"slideshow: {report['slideshow']}")
    print(f"images the TV lists now: {report['images']}")
    print(f"saved {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(run()))
    except ArtError as exc:
        sys.exit(str(exc))
