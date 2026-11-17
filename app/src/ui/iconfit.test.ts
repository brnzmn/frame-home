import { describe, expect, it } from 'vitest';
import { fitIcon } from './iconfit';

const N = 48;
const TILE_W = 264;
const TILE_H = 148;

type Colour = [number, number, number, number];

/** An n by n icon: one background colour, with a logo colour filling the given share of rows. */
function icon(bg: Colour | ((x: number, y: number) => Colour), logoRows?: [number, number], logo: Colour = [255, 255, 255, 255]): number[] {
  const px: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const inLogo = logoRows && y >= logoRows[0] * N && y < logoRows[1] * N && x > N * 0.3 && x < N * 0.7;
      px.push(...(inLogo ? logo : typeof bg === 'function' ? bg(x, y) : bg));
    }
  }
  return px;
}

describe('fitIcon', () => {
  it('rejects a rounded placeholder with transparent corners', () => {
    const rounded = icon((x, y) => (x < 4 || y < 4 || x > N - 5 || y > N - 5 ? [0, 0, 0, 0] : [20, 120, 220, 255]));
    expect(fitIcon(rounded, N, TILE_W, TILE_H).use).toBe(false);
  });

  it('lets an icon with a gradient background cover the tile', () => {
    const gradient = icon((_x, y) => [4, 49 + y * 3, 68 + y * 3, 255]);
    expect(fitIcon(gradient, N, TILE_W, TILE_H)).toEqual({ use: true, size: TILE_W, ground: null });
  });

  it('covers the tile and continues the colour when the logo is a wide band', () => {
    const wide = icon([249, 249, 250, 255], [0.4, 0.63], [229, 9, 20, 255]);
    expect(fitIcon(wide, N, TILE_W, TILE_H)).toEqual({ use: true, size: TILE_W, ground: 'rgb(249, 249, 250)' });
  });

  it('shrinks an icon whose logo is tall, so nothing is cut off', () => {
    const tall = icon([16, 124, 16, 255], [0.2, 0.8]);
    const fit = fitIcon(tall, N, TILE_W, TILE_H);
    expect(fit.ground).toBe('rgb(16, 124, 16)');
    expect(fit.size).toBeLessThan(TILE_W);
    // The logo's drawn height stays inside the tile.
    expect(fit.size * 0.6).toBeLessThan(TILE_H);
  });

  it('covers the tile when the icon is one plain colour', () => {
    expect(fitIcon(icon([60, 60, 60, 255]), N, TILE_W, TILE_H)).toEqual({ use: true, size: TILE_W, ground: 'rgb(60, 60, 60)' });
  });
});
