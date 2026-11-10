// The home screen: a Frame row of three wide cards, then rows of app tiles.
// Focus is drawn by us (a class), not by the browser: the remote only sends key presses.
import { clampPos, move, type Direction, type FocusPos, type FocusRow } from '../focus/engine';
import type { Glyph, Row, Tile } from '../data/catalog';
import { fitIcon, type IconFit } from './iconfit';

const DIRECTIONS: Record<number, Direction> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const KEY_ENTER = 13;
const SAVED_FOCUS = 'frame-home.focus';
// Keep in step with styles.css.
const TILE_W = 264;
const TILE_H = 148;
const ROW_STEP = 200;
/** Rows that fit on screen below the hero; focusing a later one scrolls the page up. */
const ROWS_ON_SCREEN = 3;
const SAMPLE = 48;

const GLYPHS: Record<Glyph, string> = {
  frame:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"><rect x="5" y="9" width="38" height="30" rx="2"/><rect x="13" y="16" width="22" height="16"/></svg>',
  toggles:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="7" y="9" width="34" height="12" rx="6"/><circle cx="35" cy="15" r="3.2" fill="currentColor" stroke="none"/><rect x="7" y="27" width="34" height="12" rx="6"/><circle cx="13" cy="33" r="3.2" fill="currentColor" stroke="none"/></svg>',
  sliders:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M7 14h18M33 14h8M7 24h6M21 24h20M7 34h22M37 34h4"/><circle cx="29" cy="14" r="4"/><circle cx="17" cy="24" r="4"/><circle cx="33" cy="34" r="4"/></svg>',
};

export interface HomeOptions {
  onOpen(tile: Tile): void;
  /** In a desktop browser, scale the 1920x1080 stage to fit the window. */
  fitToWindow: boolean;
}

export interface Home {
  /** A short message at the bottom of the screen, for things that went wrong. */
  note(text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tileNode(tile: Tile, kind: Row['kind']): HTMLElement {
  const node = el('div', kind === 'frame' ? 'card' : 'tile');
  node.style.setProperty('--from', tile.from);
  node.style.setProperty('--to', tile.to);
  node.style.setProperty('--ink', tile.ink);

  if (kind === 'frame') {
    const glyph = el('span', 'card-glyph');
    if (tile.glyph) glyph.innerHTML = GLYPHS[tile.glyph];
    const text = el('span', 'card-text');
    text.append(el('span', 'card-name', tile.name), el('span', 'card-line', tile.line));
    node.append(glyph, text);
    return node;
  }

  const face = el('div', 'tile-face');
  face.append(el('span', 'tile-word', tile.name));
  if (tile.iconUrl) {
    const img = el('img', 'tile-icon');
    img.alt = '';
    img.addEventListener('load', () => placeIcon(img, face));
    img.src = tile.iconUrl;
    face.append(img);
  }
  node.append(face);
  return node;
}

/** Look at the loaded icon and decide how it sits on the tile, or drop it for the tile's own artwork. */
function placeIcon(img: HTMLImageElement, face: HTMLElement): void {
  let fit: IconFit = { use: true, size: TILE_W, ground: null };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      fit = fitIcon(context.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, TILE_W, TILE_H);
    }
  } catch {
    // Reading the pixels is not allowed here; keep the default, which covers the tile.
  }
  if (!fit.use) {
    img.remove();
    return;
  }
  if (fit.ground) face.style.background = fit.ground;
  img.style.width = `${fit.size}px`;
  img.style.height = `${fit.size}px`;
  img.classList.add('is-loaded');
}

function readSavedFocus(): FocusPos | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FOCUS) ?? 'null');
    return saved && Number.isInteger(saved.row) && Number.isInteger(saved.col) ? saved : null;
  } catch {
    return null;
  }
}

export function mountHome(root: HTMLElement, rows: Row[], options: HomeOptions): Home {
  const stage = el('div', 'stage');
  const washes = [el('div', 'wash'), el('div', 'wash')];
  const clock = el('div', 'clock');
  const content = el('div', 'content');
  const hero = el('div', 'hero');
  const heroName = el('h1', 'hero-name');
  const heroLine = el('p', 'hero-line');
  const rowsNode = el('div', 'rows');
  const noteNode = el('div', 'note');
  hero.append(heroName, heroLine);
  content.append(hero, rowsNode);
  stage.append(...washes, content, clock, noteNode);
  root.replaceChildren(stage);

  const nodes: HTMLElement[][] = rows.map((row) => {
    const rowNode = el('div', `row row-${row.kind}`);
    const tiles = row.tiles.map((tile) => tileNode(tile, row.kind));
    rowNode.append(...tiles);
    rowsNode.append(rowNode);
    return tiles;
  });

  // Tile centres, measured once from the laid-out page. Transforms do not affect them.
  const model: FocusRow[] = nodes.map((tiles) => ({ centers: tiles.map((t) => t.offsetLeft + t.offsetWidth / 2) }));

  let focus: FocusPos | null = null;
  let activeWash = 0;

  function show(pos: FocusPos): void {
    if (focus) nodes[focus.row][focus.col].classList.remove('is-focused');
    focus = pos;
    const tile = rows[pos.row].tiles[pos.col];
    nodes[pos.row][pos.col].classList.add('is-focused');

    heroName.textContent = tile.name;
    heroLine.textContent = tile.line;

    // Rows past the third sit below the screen; slide the page up to bring the focused one in.
    const hiddenRows = Math.max(0, pos.row - (ROWS_ON_SCREEN - 1));
    content.style.transform = `translateY(${-hiddenRows * ROW_STEP}px)`;

    // Cross-fade the ambient colour: paint the hidden layer, then swap which one is visible.
    activeWash = 1 - activeWash;
    washes[activeWash].style.setProperty('--glow', tile.glow);
    washes[activeWash].classList.add('is-on');
    washes[1 - activeWash].classList.remove('is-on');

    try {
      localStorage.setItem(SAVED_FOCUS, JSON.stringify(pos));
    } catch {
      // Storage being unavailable only costs the remembered position.
    }
  }

  // Start where the user left off; the first time, on the first app tile.
  const firstApps = Math.max(0, rows.findIndex((r) => r.kind === 'apps'));
  const start = clampPos(model, readSavedFocus() ?? { row: firstApps, col: 0 });
  if (start) show(start);

  document.addEventListener('keydown', (event) => {
    if (!focus) return;
    const dir = DIRECTIONS[event.keyCode];
    if (dir) {
      event.preventDefault();
      const next = move(model, focus, dir);
      if (next.row !== focus.row || next.col !== focus.col) show(next);
      return;
    }
    if (event.keyCode === KEY_ENTER) {
      event.preventDefault();
      const node = nodes[focus.row][focus.col];
      node.classList.add('is-pressed');
      window.setTimeout(() => node.classList.remove('is-pressed'), 140);
      options.onOpen(rows[focus.row].tiles[focus.col]);
    }
  });

  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const tick = (): void => {
    clock.textContent = time.format(new Date());
  };
  tick();
  window.setInterval(tick, 15000);

  if (options.fitToWindow) {
    const fit = (): void => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      stage.style.transform = `scale(${scale})`;
    };
    fit();
    window.addEventListener('resize', fit);
  }

  let noteTimer: number | undefined;
  return {
    note(text: string): void {
      noteNode.textContent = text;
      noteNode.classList.add('is-on');
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => noteNode.classList.remove('is-on'), 4000);
    },
  };
}
