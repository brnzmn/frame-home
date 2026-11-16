import { describe, expect, it } from 'vitest';
import { PER_ROW } from '../data/catalog';
import { move, type FocusRow } from '../focus/engine';
import type { ArtItem } from '../platform/tv';
import { ART_MODE_APP, artIdOf, artRows, emptyArtRows, pickerLine, rowsToLoad } from './picker';

const item = (id: string, kind: ArtItem['kind'], thumbUrl: string | null = `thumb:${id}`): ArtItem => ({ id, kind, thumbUrl });
const mine = Array.from({ length: 8 }, (_, i) => item(`MY_F00${i}`, 'mine'));
const store = Array.from({ length: 3 }, (_, i) => item(`SAM-S00${i}`, 'store'));

// The picker's tiles sit like app tiles (styles.css): 264 px wide, 28.8 px apart.
const model = (rows: { tiles: unknown[] }[]): FocusRow[] => rows.map((r) => ({ centers: r.tiles.map((_, i) => i * (264 + 28.8) + 132) }));

describe('the Choose art grid', () => {
  it('puts own uploads first and starts the Art Store pictures on a fresh row', () => {
    const rows = artRows([...store, ...mine]);
    expect(rows.map((r) => r.tiles.length)).toEqual([PER_ROW, 2, 3]);
    expect(rows.slice(0, 2).flatMap((r) => r.tiles.map((t) => artIdOf(t)))).toEqual(mine.map((i) => i.id));
    expect(rows[2].tiles.map((t) => artIdOf(t))).toEqual(store.map((i) => i.id));
    expect(rows[0].tiles[0]).toMatchObject({ name: 'Your picture', iconUrl: 'thumb:MY_F000' });
    expect(rows[2].tiles[0].name).toBe('Art Store');
  });

  it('moves the focus like the home grid: across, down to the nearest, and stops at the edges', () => {
    const rows = artRows([...mine, ...store]);
    const grid = model(rows);
    expect(move(grid, { row: 0, col: 5 }, 'right')).toEqual({ row: 0, col: 5 });
    expect(move(grid, { row: 0, col: 5 }, 'down')).toEqual({ row: 1, col: 1 });
    expect(move(grid, { row: 1, col: 1 }, 'down')).toEqual({ row: 2, col: 1 });
    expect(move(grid, { row: 2, col: 2 }, 'down')).toEqual({ row: 2, col: 2 });
    expect(move(grid, { row: 0, col: 0 }, 'up')).toEqual({ row: 0, col: 0 });
    expect(move(grid, { row: 0, col: 0 }, 'left')).toEqual({ row: 0, col: 0 });
  });

  it('names the focused picture and where it is', () => {
    const rows = artRows([...mine, ...store]);
    expect(pickerLine(rows, 0, 0)).toBe('Your picture · 1 of 11');
    expect(pickerLine(rows, 2, 2)).toBe('Art Store · 11 of 11');
  });

  it('loads thumbnails only for the rows on screen and the next one', () => {
    expect(rowsToLoad(0, 3, 10)).toEqual([0, 1, 2, 3]);
    expect(rowsToLoad(4, 3, 6)).toEqual([4, 5]);
    expect(rowsToLoad(0, 3, 1)).toEqual([0]);
  });

  it('offers one Open Art Mode button when nothing is cached yet', () => {
    const rows = emptyArtRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].tiles).toHaveLength(1);
    expect(rows[0].tiles[0]).toMatchObject({ appId: ART_MODE_APP, name: 'Open Art Mode' });
    expect(artIdOf(rows[0].tiles[0])).toBeNull();
  });

  it('keeps a picture without a thumbnail as a plain box', () => {
    const rows = artRows([item('MY_F0001', 'mine', null)]);
    expect(rows[0].tiles[0].iconUrl).toBeNull();
  });
});
