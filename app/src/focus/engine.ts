// Remote-control navigation over rows of tiles. Pure logic, no DOM.
// Rows can hold tiles of different widths, so moving up or down lands on the tile whose
// centre is closest to where you were, the way it does on a TV home screen.

export interface FocusRow {
  /** Horizontal centre of each tile in the row, in any one consistent unit. */
  centers: number[];
}

export interface FocusPos {
  row: number;
  col: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

function nearest(centers: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < centers.length; i++) {
    if (Math.abs(centers[i] - x) < Math.abs(centers[best] - x)) best = i;
  }
  return best;
}

/** A position that is guaranteed to point at a real tile, or null when there are none. */
export function clampPos(rows: FocusRow[], pos: FocusPos): FocusPos | null {
  const filled = rows.map((r, i) => (r.centers.length ? i : -1)).filter((i) => i >= 0);
  if (!filled.length) return null;
  const row = filled.includes(pos.row) ? pos.row : filled.reduce((a, b) => (Math.abs(b - pos.row) < Math.abs(a - pos.row) ? b : a));
  const col = Math.min(Math.max(pos.col, 0), rows[row].centers.length - 1);
  return { row, col };
}

/** Where the focus goes for one key press. Edges stop; empty rows are skipped. */
export function move(rows: FocusRow[], from: FocusPos, dir: Direction): FocusPos {
  const pos = clampPos(rows, from);
  if (!pos) return from;

  if (dir === 'left' || dir === 'right') {
    const col = pos.col + (dir === 'right' ? 1 : -1);
    return col < 0 || col >= rows[pos.row].centers.length ? pos : { row: pos.row, col };
  }

  const step = dir === 'down' ? 1 : -1;
  for (let row = pos.row + step; row >= 0 && row < rows.length; row += step) {
    if (rows[row].centers.length) {
      return { row, col: nearest(rows[row].centers, rows[pos.row].centers[pos.col]) };
    }
  }
  return pos;
}
