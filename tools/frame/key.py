"""Press remote keys on the TV from the Mac, for tests that need a real key press.

  key.py KEY_HOME            one key
  key.py KEY_HOME KEY_RETURN several, one second apart

Key names are Samsung's: KEY_HOME, KEY_RETURN, KEY_EXIT, KEY_ENTER, KEY_UP, KEY_DOWN, KEY_LEFT,
KEY_RIGHT, KEY_POWER (on a Frame a short press switches between TV and Art Mode).
"""
import sys
import time

from tv import connect


def main() -> None:
    keys = sys.argv[1:]
    if not keys:
        sys.exit(__doc__)
    tv = connect()
    for i, key in enumerate(keys):
        if i:
            time.sleep(1)
        tv.send_key(key)
        print(f"sent {key}")
    tv.close()


if __name__ == "__main__":
    main()
