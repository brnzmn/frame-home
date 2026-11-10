"""Phase 0 art-controls test. Read-only unless a test flag is given.

  check.py                  what the TV reports: art mode, images, mats, filters, art settings
  check.py --write-test     also change one image's mat and change it back
  check.py --artmode-test   also switch Art Mode over and back (changes what the screen shows)

Writes docs/art-check.json. Device ids, addresses and tokens are never read or stored.
"""
from __future__ import annotations

import argparse
import time
from collections import Counter

from tv import ROOT, connect, is_own, write_json


def step(report: dict, name: str, fn):
    """Run one check, record ok/fail, never stop the whole run."""
    try:
        value = fn()
        report[name] = {"status": "ok", "value": value}
        return value
    except Exception as exc:  # the TV answers differently per model year; record and move on
        report[name] = {"status": "fail", "error": f"{type(exc).__name__}: {exc}"}
        return None


def find_item(art, content_id: str) -> dict | None:
    return next((i for i in art.available() if i.get("content_id") == content_id), None)


def write_test(art, items: list[dict], types: list, colours: list) -> dict:
    """Change one own image's mat, confirm the TV reports it, then restore the original."""
    own = [i for i in items if is_own(i) and i.get("matte_id")]
    if not own:
        return {"status": "skipped", "reason": "no own image with a mat setting"}
    target = own[0]
    cid, original = target["content_id"], target["matte_id"]
    type_names = [t.get("matte_type") for t in types if t.get("matte_type")]
    colour_names = [c.get("color") for c in colours if c.get("color")]
    candidates = [f"{t}_{c}" for t in type_names[:3] for c in colour_names[:2]] + ["none"]
    candidates = [m for m in candidates if m != original]
    tried = []
    for matte in candidates[:5]:
        try:
            art.change_matte(cid, matte)
            time.sleep(1.5)
            now = (find_item(art, cid) or {}).get("matte_id")
        except Exception as exc:
            tried.append({"matte": matte, "error": f"{type(exc).__name__}: {exc}"})
            continue
        tried.append({"matte": matte, "tv_reports": now})
        if now == matte:
            art.change_matte(cid, original)
            time.sleep(1.5)
            restored = (find_item(art, cid) or {}).get("matte_id")
            return {
                "status": "ok" if restored == original else "changed-but-not-restored",
                "content_id": cid,
                "original": original,
                "changed_to": matte,
                "restored_to": restored,
                "tried": tried,
            }
    return {"status": "fail", "content_id": cid, "original": original, "tried": tried}


def artmode_test(art) -> dict:
    before = art.get_artmode()
    flipped = "off" if before == "on" else "on"
    art.set_artmode(flipped == "on")
    time.sleep(4)
    during = art.get_artmode()
    art.set_artmode(before == "on")
    time.sleep(4)
    after = art.get_artmode()
    return {"status": "ok" if during == flipped and after == before else "fail", "before": before, "during": during, "after": after}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write-test", action="store_true")
    parser.add_argument("--artmode-test", action="store_true")
    args = parser.parse_args()

    report: dict = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    art = connect().art()

    step(report, "supported", art.supported)
    step(report, "api_version", art.get_api_version)
    step(report, "power_state", art.get_power_state)
    step(report, "artmode", art.get_artmode)
    step(report, "current", lambda: {k: v for k, v in (art.get_current() or {}).items() if k in ("content_id", "matte_id", "portrait_matte_id", "category_id")})

    items = step(report, "images_raw", art.available) or []
    report.pop("images_raw", None)
    report["images"] = {
        "status": "ok" if items else "fail",
        "total": len(items),
        "own": sum(1 for i in items if is_own(i)),
        "by_category": dict(Counter(str(i.get("category_id")) for i in items)),
        "by_matte": dict(Counter(str(i.get("matte_id")) for i in items)),
        "keys_seen": sorted({k for i in items[:20] for k in i}),
    }

    mats = step(report, "mats", lambda: art.get_matte_list(include_colour=True))
    types, colours = (mats or ([], []))[0], (mats or ([], []))[1]
    step(report, "photo_filters", art.get_photo_filter_list)
    step(report, "art_settings", art.get_artmode_settings)

    if args.write_test:
        step(report, "write_test", lambda: write_test(art, items, types, colours))
    if args.artmode_test:
        step(report, "artmode_test", lambda: artmode_test(art))

    out = ROOT / "docs" / "art-check.json"
    write_json(out, report)
    for name, value in report.items():
        if isinstance(value, dict) and "status" in value:
            detail = value.get("value", {k: v for k, v in value.items() if k != "status"})
            print(f"{name}: {value['status']}  {str(detail)[:160]}")
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
