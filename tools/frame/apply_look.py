"""Put one frame look on every image, so no image needs a visit to the TV menu.
The TV must be in Art Mode: its art service only answers then.

  apply_look.py                 dry run: what would change
  apply_look.py --apply         save the current mats, then change them
  apply_look.py --restore FILE  put back the mats saved in a backup file

frame-look.json (copy frame-look.example.json):
  "matte"           the mat, as the TV names it: "<style>_<colour>", e.g. "shadowbox_polar"
  "scope"           "slideshow" = Art Store and stream images the TV lists
                    "mine"      = your own uploaded photos
                    "all"       = both

Each image has two mats, "landscape" and "portrait". This tool only replaces a mat the image
already has. It never adds one where the TV says "none", because the TV refuses to set a
portrait mat back to "none" afterwards (error -7), which would make the change permanent.
The TV also refuses some styles on some images; those are listed, never forced.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from artws import ArtChannel, ArtError, mats_of
from tv import LOOK_FILE, PRIVATE_DIR, ROOT, is_own, write_json

PAUSE = 0.4  # seconds between changes, so the TV is not flooded


def load_look() -> str:
    if not LOOK_FILE.exists():
        sys.exit("No frame-look.json yet. Copy frame-look.example.json and set the mat (styles and colours: check.py).")
    look = json.loads(LOOK_FILE.read_text())
    matte = str(look.get("matte") or "").lower()
    if not matte or matte == "none":
        sys.exit('frame-look.json needs a "matte" such as "shadowbox_polar". Removing mats is not supported: the TV refuses "none".')
    return matte


def wanted(item: dict, matte: str) -> tuple[str, str]:
    """The look for one image: replace each mat it has, leave "none" alone."""
    landscape, portrait = mats_of(item)
    return (matte if landscape != "none" else "none", matte if portrait != "none" else "none")


async def inventory(art: ArtChannel, scope: str) -> dict[str, dict]:
    """Every image in scope, by content id."""
    show = await art.slideshow()
    if scope != "mine" and not show["running"]:
        print("No slideshow is running, so the TV lists only recently shown images.")
    found: dict[str, dict] = {}
    for item in await art.known_images():
        own = is_own(item)
        if scope == "all" or (scope == "mine") == own:
            found[item["content_id"]] = item
    return found


async def apply_mats(art: ArtChannel, changes: dict[str, tuple[str, str]]) -> dict[str, str]:
    errors: dict[str, str] = {}
    for cid, (landscape, portrait) in changes.items():
        try:
            await art.change_mat(cid, landscape, portrait)
        except ArtError as exc:
            errors[cid] = str(exc).split(" {")[0]
        await asyncio.sleep(PAUSE)
    return errors


async def run(args: argparse.Namespace) -> int:
    async with ArtChannel() as art:
        if not await art.art_mode_on():
            print("The art service is not answering. Switch the TV to Art Mode (short press on power) and run this again.")
            return 1

        if args.restore:
            saved = json.loads(args.restore.read_text())
            errors = await apply_mats(art, {cid: (m["matte_id"], m["portrait_matte_id"]) for cid, m in saved.items()})
            print(f"restored {len(saved) - len(errors)} of {len(saved)} images; failed: {errors or 'none'}")
            return 0 if not errors else 2

        matte = load_look()
        scope = json.loads(LOOK_FILE.read_text()).get("scope", "slideshow")
        before = await inventory(art, scope)
        changes = {cid: wanted(item, matte) for cid, item in before.items() if wanted(item, matte) != mats_of(item)}
        no_mat = sum(1 for item in before.values() if mats_of(item) == ("none", "none"))
        print(f"{len(before)} images in scope '{scope}': {len(changes)} to change, {no_mat} have no mat and are left alone, {len(before) - len(changes) - no_mat} already match")

        if not args.apply:
            for cid in list(changes)[:12]:
                print(f"  would change {cid}: {mats_of(before[cid])} -> {changes[cid]}")
            print("dry run only. Add --apply to change them.")
            return 0

        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = PRIVATE_DIR / f"matte-backup-{stamp}.json"
        write_json(backup, {cid: dict(zip(("matte_id", "portrait_matte_id"), mats_of(before[cid]))) for cid in changes})
        print(f"current mats saved to {backup.relative_to(ROOT)}")

        errors = await apply_mats(art, changes)
        await asyncio.sleep(2)
        after = await inventory(art, scope)
        refused = [cid for cid in changes if cid not in after or mats_of(after[cid]) != changes[cid]]
        print(f"changed and confirmed by the TV: {len(changes) - len(refused)}")
        print(f"refused by the TV: {len(refused)}")
        for cid in refused:
            print(f"  {cid}: TV reports {mats_of(after[cid]) if cid in after else 'no longer listed'}  {errors.get(cid, '')}")
        write_json(PRIVATE_DIR / f"apply-result-{stamp}.json", {"matte": matte, "scope": scope, "changed": len(changes) - len(refused), "refused": refused, "errors": errors})
        return 0 if not refused else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--restore", type=Path)
    try:
        sys.exit(asyncio.run(run(parser.parse_args())))
    except ArtError as exc:
        sys.exit(str(exc))
