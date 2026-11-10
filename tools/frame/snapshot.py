"""Record the TV's Art Mode settings (brightness, colour tone, sleep and motion options)
so they can be compared or re-applied after a reset or firmware update.

  snapshot.py    writes docs/art-settings-snapshot.json
"""
from __future__ import annotations

import time
from collections import Counter

from tv import ROOT, connect, write_json


def main() -> None:
    art = connect().art()
    snapshot = {"taken_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    for name, fn in (("art_settings", art.get_artmode_settings), ("slideshow", art.get_slideshow_status), ("auto_rotation", art.get_auto_rotation_status)):
        try:
            snapshot[name] = fn()
        except Exception as exc:
            snapshot[name] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        snapshot["mats_in_use"] = dict(Counter(str(i.get("matte_id")) for i in art.available()))
    except Exception as exc:
        snapshot["mats_in_use"] = {"error": f"{type(exc).__name__}: {exc}"}
    out = ROOT / "docs" / "art-settings-snapshot.json"
    write_json(out, snapshot)
    print(f"saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
