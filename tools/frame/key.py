"""Press remote keys on the TV from the Mac, for tests that need a real key press.

  key.py KEY_HOME                      one key
  key.py KEY_HOME wait:4 KEY_HOME      keys with a pause in seconds between them

Key names are Samsung's: KEY_HOME, KEY_RETURN, KEY_EXIT, KEY_ENTER, KEY_UP, KEY_DOWN, KEY_LEFT,
KEY_RIGHT, KEY_POWER (on a Frame a short press switches between TV and Art Mode).
"""
import sys
import time

from tv import connect


def main() -> None:
    steps = sys.argv[1:]
    if not steps:
        sys.exit(__doc__)
    tv = connect()
    for step in steps:
        if step.startswith("wait:"):
            time.sleep(float(step[5:]))
            continue
        tv.send_key(step, key_press_delay=0)
        print(f"{time.strftime('%H:%M:%S')} sent {step}", flush=True)
    tv.close()


if __name__ == "__main__":
    main()
