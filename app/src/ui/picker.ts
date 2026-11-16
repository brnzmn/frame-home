// The Choose art screen: the owner's pictures as a grid of thumbnails, own uploads first, then
// the Art Store pictures the TV lists. It is a third screen inside the home page (home.ts swaps it
// in like All apps) and uses the same tile boxes, focus and scrolling.
//
// The pictures come from the keeper's cache (app/public/service/keeper.js), filled whenever Art
// Mode answers. Choosing one queues it with the keeper and opens Art Mode, where the keeper shows it.
//
// Speed rules: every box has a fixed size, so nothing reflows when a thumbnail arrives; thumbnails
// load only for the rows on screen and the next one, and fade in (opacity only).
import { PER_ROW, type Row, type Tile } from '../data/catalog';
import type { ArtItem } from '../platform/tv';

/** Picture tiles carry this in front of the content id, in place of an app id. */
export const ART_PREFIX = 'frame-home:art:';
/** Samsung's Art Mode, opened from the first-use screen. */
export const ART_MODE_APP = 'org.tizen.art-app';

export const PICKER_TITLE = 'Choose art';
export const FIRST_USE_LINE = 'Your pictures load the first time Art Mode is opened from here.';
export const NO_KEEPER_LINE = 'Your pictures cannot be read right now. Open Art Mode and come back.';

const KIND_NAME: Record<ArtItem['kind'], string> = { mine: 'Your picture', store: 'Art Store' };

function artTile(item: ArtItem): Tile {
  return {
    appId: ART_PREFIX + item.id,
    name: KIND_NAME[item.kind],
    line: '',
    from: '#2A2631',
    to: '#1F1C25',
    ink: '#A9A3B2',
    glow: '#A8937A',
    // The thumbnail, loaded only when its row comes on screen (loadThumbs).
    iconUrl: item.thumbUrl,
  };
}

/** The pictures in rows of PER_ROW: own uploads first, and the Art Store ones from a fresh row. */
export function artRows(items: ArtItem[], perRow = PER_ROW): Row[] {
  const rows: Row[] = [];
  for (const kind of ['mine', 'store'] as const) {
    const tiles = items.filter((i) => i.kind === kind).map(artTile);
    for (let i = 0; i < tiles.length; i += perRow) rows.push({ kind: 'apps', tiles: tiles.slice(i, i + perRow) });
  }
  return rows;
}

/** The first-use screen: one button that opens Art Mode, so the keeper can fill its cache. */
export function emptyArtRows(): Row[] {
  return [
    {
      kind: 'frame',
      tiles: [{ appId: ART_MODE_APP, name: 'Open Art Mode', line: 'Then come back here', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#B9A88A', iconUrl: null, glyph: 'frame' }],
    },
  ];
}

/** The content id of a picture tile, or null for any other tile. */
export function artIdOf(tile: Tile): string | null {
  return tile.appId.startsWith(ART_PREFIX) ? tile.appId.slice(ART_PREFIX.length) : null;
}

/** The hero line for the focused picture: what it is and where it sits in the grid. */
export function pickerLine(rows: Row[], row: number, col: number): string {
  const tile = rows[row]?.tiles[col];
  if (!tile || !artIdOf(tile)) return tile?.line ?? '';
  let index = 0;
  let total = 0;
  rows.forEach((r, i) => {
    if (i < row) index += r.tiles.length;
    total += r.tiles.length;
  });
  return `${tile.name} · ${index + col + 1} of ${total}`;
}

/** Rows whose thumbnails should load: the ones on screen after scrolling `shift` rows, and one more. */
export function rowsToLoad(shift: number, rowsOnScreen: number, total: number): number[] {
  const out: number[] = [];
  for (let row = Math.max(0, shift); row < Math.min(total, shift + rowsOnScreen + 1); row++) out.push(row);
  return out;
}

/** A picture tile: the app tile's fixed box, its kind as a quiet word until the thumbnail is in. */
export function artTileNode(tile: Tile): HTMLElement {
  const node = document.createElement('div');
  node.className = 'tile art-tile';
  node.style.setProperty('--from', tile.from);
  node.style.setProperty('--to', tile.to);
  node.style.setProperty('--ink', tile.ink);
  const face = document.createElement('div');
  face.className = 'tile-face';
  const word = document.createElement('span');
  word.className = 'tile-word';
  word.textContent = tile.name;
  face.append(word);
  if (tile.iconUrl) {
    const img = document.createElement('img');
    img.className = 'art-thumb';
    img.alt = '';
    img.decoding = 'async';
    img.dataset.src = tile.iconUrl;
    img.addEventListener('load', () => img.classList.add('is-loaded'));
    img.addEventListener('error', () => img.remove());
    face.append(img);
  }
  node.append(face);
  return node;
}

/** Start loading the thumbnails of these rows; rows already loading are left alone. */
export function loadThumbs(nodes: HTMLElement[][], rows: number[]): void {
  for (const row of rows) {
    for (const node of nodes[row] ?? []) {
      const img = node.querySelector<HTMLImageElement>('img.art-thumb');
      if (img && img.dataset.src) {
        img.src = img.dataset.src;
        delete img.dataset.src;
      }
    }
  }
}
