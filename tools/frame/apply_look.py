"""Put one frame look on every image, so no image needs a visit to the TV menu.

  apply_look.py                 dry run: what would change
  apply_look.py --apply         save the current mats, then change them
  apply_look.py --restore FILE  put back the mats saved in a backup file

frame-look.json (copy frame-look.example.json):
  "matte"          mat style and colour as the TV names them, e.g. "shadowbox_polar", or "none"
  "portrait_matte" mat for portrait images, or null to leave them
  "photo_filter"   filter id as the TV names it, or null to leave filters alone
  "scope"          "mine" = your own photos, "all" = everything the TV lists (Art Store pieces may refuse)

The TV does not accept every mat on every image shape. Refused images are listed, never forced.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from tv import LOOK_FILE, PRIVATE_DIR, ROOT, connect, is_own, write_json


def load_look() -> dict:
    if not LOOK_FILE.exists():
        sys.exit("No frame-look.json yet. Copy frame-look.example.json and set the mat from docs/art-check.json.")
    look = json.loads(LOOK_FILE.read_text())
    if not look.get("matte"):
        sys.exit('frame-look.json needs a "matte" value, e.g. "shadowbox_polar" or "none".')
    return look


def needs_change(item: dict, look: dict) -> bool:
    if item.get("matte_id") != look["matte"]:
        return True
    portrait = look.get("portrait_matte")
    return bool(portrait) and item.get("portrait_matte_id") not in (None, portrait)


def restore(art, backup_file: Path) -> None:
    saved = json.loads(backup_file.read_text())
    failed = []
    for cid, mats in saved.items():
        try:
            art.change_matte(cid, mats.get("matte_id") or "none", mats.get("portrait_matte_id"))
            time.sleep(0.4)
        except Exception as exc:
            failed.append({"content_id": cid, "error": f"{type(exc).__name__}: {exc}"})
    print(f"restored {len(saved) - len(failed)} of {len(saved)} images; failed: {failed or 'none'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--restore", type=Path)
    args = parser.parse_args()

    art = connect().art()
    if args.restore:
        restore(art, args.restore)
        return

    look = load_look()
    items = art.available()
    in_scope = items if look.get("scope") == "all" else [i for i in items if is_own(i)]
    todo = [i for i in in_scope if needs_change(i, look)]
    print(f"{len(items)} images on the TV, {len(in_scope)} in scope, {len(todo)} need the look, {len(in_scope) - len(todo)} already have it")

    if not args.apply:
        for i in todo[:15]:
            print(f"  would change {i.get('content_id')}: {i.get('matte_id')} -> {look['matte']}")
        print("dry run only. Add --apply to change them.")
        return

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = PRIVATE_DIR / f"matte-backup-{stamp}.json"
    write_json(backup, {i["content_id"]: {"matte_id": i.get("matte_id"), "portrait_matte_id": i.get("portrait_matte_id")} for i in in_scope})
    print(f"current mats saved to {backup.relative_to(ROOT)}")

    errors = {}
    for i in todo:
        cid = i["content_id"]
        try:
            art.change_matte(cid, look["matte"], look.get("portrait_matte"))
            if look.get("photo_filter"):
                art.set_photo_filter(cid, look["photo_filter"])
            time.sleep(0.4)
        except Exception as exc:
            errors[cid] = f"{type(exc).__name__}: {exc}"

    after = {i.get("content_id"): i for i in art.available()}
    refused = [cid for cid in (i["content_id"] for i in todo) if (after.get(cid) or {}).get("matte_id") != look["matte"]]
    print(f"changed and confirmed by the TV: {len(todo) - len(refused)}")
    print(f"refused by the TV: {len(refused)}")
    for cid in refused:
        print(f"  {cid}: TV still reports {(after.get(cid) or {}).get('matte_id')}  {errors.get(cid, '')}")
    write_json(PRIVATE_DIR / f"apply-result-{stamp}.json", {"look": look, "changed": len(todo) - len(refused), "refused": refused, "errors": errors})


if __name__ == "__main__":
    main()
