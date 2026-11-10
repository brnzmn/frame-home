// How a square app icon sits on a wide tile. Measured on the TV: every icon is square
// (117 to 512 px), some have a flat background with a tall logo, some a gradient with a
// wide logo, and a few are rounded placeholders with transparent corners.

export interface IconFit {
  /** False when the icon is not worth showing; the tile keeps its own artwork. */
  use: boolean;
  /** Width and height to draw the icon at, centred on the tile. */
  size: number;
  /** Background colour to continue across the tile, when the icon has one flat colour. */
  ground: string | null;
}

const SAME_COLOUR = 40;
const DIFFERENT = 60;

/**
 * @param pixels RGBA values of the icon scaled to n by n
 * @param tileW width of the tile; a square icon drawn this wide covers the tile
 * @param tileH height of the tile
 */
export function fitIcon(pixels: ArrayLike<number>, n: number, tileW: number, tileH: number): IconFit {
  const at = (x: number, y: number): [number, number, number, number] => {
    const i = (y * n + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };
  const distance = (a: number[], b: number[]): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  const corners = [at(1, 1), at(n - 2, 1), at(1, n - 2), at(n - 2, n - 2)];
  if (corners.some((c) => c[3] < 200)) return { use: false, size: 0, ground: null };

  const bg = corners[0];
  const flat = corners.every((c) => distance(c, bg) < SAME_COLOUR);
  // A gradient background has no single colour to continue, so let the icon cover the tile.
  if (!flat) return { use: true, size: tileW, ground: null };

  let top = n;
  let bottom = -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (distance(at(x, y), bg) > DIFFERENT) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        break;
      }
    }
  }
  const ground = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
  if (bottom < top) return { use: true, size: tileW, ground };

  // Size the icon so its logo takes about two thirds of the tile's height, never wider than the tile.
  const logoShare = Math.min(1, (bottom - top + 1) / n + 0.08);
  return { use: true, size: Math.min(tileW, Math.round((0.66 * tileH) / logoShare)), ground };
}
