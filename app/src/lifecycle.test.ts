import { describe, expect, it } from 'vitest';
import {
  DOUBLE_PRESS_MS,
  MAX_REQUESTS,
  RETRY_AFTER_MS,
  SAMSUNG_HOME,
  SLEEP_NOTICE_MS,
  idleWatch,
  mayJump,
  newlyConnected,
  onHidden,
  onReading,
  onWaiting,
  type HomeWatch,
} from './lifecycle';

describe('the moment the launcher goes hidden', () => {
  it('jumps back at once when Home was pressed on the launcher', () => {
    expect(onHidden(false, SAMSUNG_HOME, null)).toBe('jump');
    expect(onHidden(false, SAMSUNG_HOME, DOUBLE_PRESS_MS + 1)).toBe('jump');
  });

  it('leaves Samsung home up on a second Home press', () => {
    expect(onHidden(false, SAMSUNG_HOME, 1500)).toBe('stay');
  });

  it('only watches when the TV went to Art Mode or between apps', () => {
    expect(onHidden(false, 'org.tizen.art-app', null)).toBe('watch');
    expect(onHidden(false, null, null)).toBe('watch');
  });

  it('only watches when the launcher opened an app itself', () => {
    expect(onHidden(true, SAMSUNG_HOME, null)).toBe('watch');
    expect(onHidden(true, 'org.tizen.netflix-app', null)).toBe('watch');
  });
});

/** Feed a run of readings and report on which reading, if any, the launcher jumps back. */
function run(readings: Array<string | null>, msSinceLastJump: number | null, start: HomeWatch = idleWatch) {
  let watch = start;
  let jumpedAt = -1;
  readings.forEach((foreground, i) => {
    if (jumpedAt >= 0) return;
    const result = onReading(watch, foreground, msSinceLastJump);
    watch = result.watch;
    if (result.jump) jumpedAt = i;
  });
  return { watch, jumpedAt };
}

describe('jumping back over Samsung home', () => {
  it('jumps back once Samsung home has been seen twice in a row', () => {
    expect(run([SAMSUNG_HOME, SAMSUNG_HOME], null).jumpedAt).toBe(1);
  });

  it('does not act on a single passing reading', () => {
    expect(run([SAMSUNG_HOME, 'org.tizen.netflix-app', SAMSUNG_HOME], null).jumpedAt).toBe(-1);
  });

  it('never jumps while the TV is in Art Mode or between apps', () => {
    expect(run([null, 'org.tizen.art-app', 'org.tizen.art-app', null, 'org.tizen.art-app'], null).jumpedAt).toBe(-1);
  });

  it('never jumps while another app is in front', () => {
    expect(run(['org.tizen.netflix-app', 'org.tizen.netflix-app', 'org.tizen.netflix-app'], null).jumpedAt).toBe(-1);
  });

  it('leaves Samsung home up when Home is pressed again right after a jump', () => {
    const many = Array(20).fill(SAMSUNG_HOME);
    expect(run(many, DOUBLE_PRESS_MS - 1000).jumpedAt).toBe(-1);
  });

  it('keeps leaving it up after the double-press window has passed', () => {
    const first = run([SAMSUNG_HOME], 2000);
    expect(first.watch.letHomeStay).toBe(true);
    expect(run(Array(10).fill(SAMSUNG_HOME), DOUBLE_PRESS_MS + 60000, first.watch).jumpedAt).toBe(-1);
  });

  it('goes back to jumping once the user has moved from Samsung home into an app', () => {
    const stayed = run([SAMSUNG_HOME, SAMSUNG_HOME], 2000);
    const later = run(['org.tizen.netflix-app', SAMSUNG_HOME, SAMSUNG_HOME], DOUBLE_PRESS_MS + 60000, stayed.watch);
    expect(later.jumpedAt).toBe(2);
  });

  it('jumps again when the last jump was long ago', () => {
    expect(run([SAMSUNG_HOME, SAMSUNG_HOME], DOUBLE_PRESS_MS + 1).jumpedAt).toBe(1);
  });

  it('holds its state through readings the TV does not answer', () => {
    expect(run([SAMSUNG_HOME, null, SAMSUNG_HOME], null).jumpedAt).toBe(2);
  });
});

describe('after asking to be brought forward', () => {
  const OWN = 'FrameHome1.FrameHome';

  it('waits, then asks again while Samsung home is still in front', () => {
    expect(onWaiting(SAMSUNG_HOME, OWN, RETRY_AFTER_MS - 1, 1)).toBe('wait');
    expect(onWaiting(SAMSUNG_HOME, OWN, RETRY_AFTER_MS, 1)).toBe('again');
  });

  it('keeps asking when the TV does not say what is in front, or already names the launcher', () => {
    expect(onWaiting(null, OWN, RETRY_AFTER_MS, 3)).toBe('again');
    expect(onWaiting(OWN, OWN, RETRY_AFTER_MS, 3)).toBe('again');
  });

  it('drops it at once when another app or Art Mode is in front', () => {
    expect(onWaiting('org.tizen.netflix-app', OWN, 0, 1)).toBe('drop');
    expect(onWaiting('org.tizen.art-app', OWN, RETRY_AFTER_MS * 5, 2)).toBe('drop');
  });

  it('gives up after enough requests instead of asking all night', () => {
    expect(onWaiting(SAMSUNG_HOME, OWN, RETRY_AFTER_MS, MAX_REQUESTS - 1)).toBe('again');
    expect(onWaiting(SAMSUNG_HOME, OWN, RETRY_AFTER_MS, MAX_REQUESTS)).toBe('give up');
  });
});

describe('Samsung home after Art Mode', () => {
  it('comes back when the TV was switched on from Art Mode', () => {
    expect(mayJump(true, null, SAMSUNG_HOME)).toBe(true);
    expect(mayJump(true, SLEEP_NOTICE_MS + 1, SAMSUNG_HOME)).toBe(true);
  });

  it('stays away when the TV has just said it is going to sleep', () => {
    expect(mayJump(true, 1500, SAMSUNG_HOME)).toBe(false);
  });

  it('never lets a sleep notice hold up a Home press', () => {
    expect(mayJump(false, 1500, SAMSUNG_HOME)).toBe(true);
    expect(mayJump(false, null, SAMSUNG_HOME)).toBe(true);
  });

  it('stays away when something else came in front while it was asking', () => {
    expect(mayJump(true, null, 'org.tizen.netflix-app')).toBe(false);
    expect(mayJump(true, null, 'org.tizen.art-app')).toBe(false);
    expect(mayJump(true, null, null)).toBe(false);
  });
});

describe('a console switching on while the launcher is on screen', () => {
  it('notices an HDMI input that was not connected a moment ago', () => {
    expect(newlyConnected(['TV1'], ['TV1', 'HDMI3'])).toEqual(['HDMI3']);
  });
  it('does nothing while the same inputs stay connected', () => {
    expect(newlyConnected(['TV1', 'HDMI3'], ['TV1', 'HDMI3'])).toEqual([]);
  });
  it('does nothing when an input goes away', () => {
    expect(newlyConnected(['TV1', 'HDMI3'], ['TV1'])).toEqual([]);
  });
  it('does nothing on the first reading, or when the TV will not say', () => {
    expect(newlyConnected(null, ['TV1', 'HDMI3'])).toEqual([]);
    expect(newlyConnected(['TV1'], null)).toEqual([]);
  });
});
