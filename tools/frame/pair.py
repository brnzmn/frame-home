"""Pair this Mac with the TV's controls.

The TV shows an Allow prompt once; press Allow with the remote. The pairing token is saved in
tools/frame/.tokens/ (gitignored) and is never printed.

  tools/frame/.venv/bin/python tools/frame/pair.py
"""
from tv import connect


def main() -> None:
    tv = connect(timeout=70)
    print("Asking the TV. Press Allow on the TV if it asks.")
    token = tv.art().pair(timeout=60)
    print("paired" if token else "not paired: no answer from the TV within 60 seconds")
    raise SystemExit(0 if token else 1)


if __name__ == "__main__":
    main()
