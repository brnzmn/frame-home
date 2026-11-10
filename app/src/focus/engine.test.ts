import { describe, expect, it } from 'vitest';
import { clampPos, move, type FocusRow } from './engine';

// Three wide cards over six tiles over four tiles, as on the home screen.
const rows: FocusRow[] = [
  { centers: [278, 862, 1446] },
  { centers: [132, 425, 718, 1010, 1303, 1596] },
  { centers: [132, 425, 718, 1010] },
];

describe('move', () => {
  it('steps along a row and stops at both edges', () => {
    expect(move(rows, { row: 1, col: 0 }, 'right')).toEqual({ row: 1, col: 1 });
    expect(move(rows, { row: 1, col: 0 }, 'left')).toEqual({ row: 1, col: 0 });
    expect(move(rows, { row: 1, col: 5 }, 'right')).toEqual({ row: 1, col: 5 });
  });

  it('lands on the tile closest to where you were when changing rows', () => {
    expect(move(rows, { row: 1, col: 0 }, 'up')).toEqual({ row: 0, col: 0 });
    expect(move(rows, { row: 1, col: 3 }, 'up')).toEqual({ row: 0, col: 1 });
    expect(move(rows, { row: 1, col: 5 }, 'up')).toEqual({ row: 0, col: 2 });
    expect(move(rows, { row: 0, col: 2 }, 'down')).toEqual({ row: 1, col: 4 });
  });

  it('goes to the last tile of a shorter row', () => {
    expect(move(rows, { row: 1, col: 5 }, 'down')).toEqual({ row: 2, col: 3 });
  });

  it('stops at the top and bottom rows', () => {
    expect(move(rows, { row: 0, col: 1 }, 'up')).toEqual({ row: 0, col: 1 });
    expect(move(rows, { row: 2, col: 1 }, 'down')).toEqual({ row: 2, col: 1 });
  });

  it('skips a row with no tiles', () => {
    const withGap: FocusRow[] = [rows[0], { centers: [] }, rows[2]];
    expect(move(withGap, { row: 0, col: 1 }, 'down')).toEqual({ row: 2, col: 2 });
    expect(move(withGap, { row: 2, col: 3 }, 'up')).toEqual({ row: 0, col: 1 });
  });
});

describe('clampPos', () => {
  it('pulls a saved position back onto a real tile after the app list changed', () => {
    expect(clampPos(rows, { row: 2, col: 9 })).toEqual({ row: 2, col: 3 });
    expect(clampPos(rows, { row: 7, col: 0 })).toEqual({ row: 2, col: 0 });
  });

  it('returns null when there is nothing to focus', () => {
    expect(clampPos([{ centers: [] }], { row: 0, col: 0 })).toBeNull();
  });
});
