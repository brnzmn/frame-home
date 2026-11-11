import { describe, expect, it } from 'vitest';
import { DOUBLE_PRESS_MS, SAMSUNG_HOME, idleWatch, onHidden, onReading, type HomeWatch } from './lifecycle';

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
