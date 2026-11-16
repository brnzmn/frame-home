// The home screen: a Frame row of three wide cards, then rows of app tiles. The All apps tile
// swaps the rows for a grid of every other app, inside the same page.
// Focus is drawn by us (a class), not by the browser: the remote only sends key presses.
//
// Speed rule (measured on the TV, see docs/decisions.md): a focus move may only change
// `transform` and `opacity`. Shadows, colours and the ambient wash are painted once and faded.
import { clampPos, move, type Direction, type FocusPos, type FocusRow } from '../focus/engine';
import { ALL_APPS_ID, type Catalog, type Glyph, type Row, type Tile } from '../data/catalog';
import { fitIcon, type IconFit } from './iconfit';

/**
 * The ambient colour behind the screen. One static full-screen layer per glow colour, painted
 * once; a focus move only crossfades the opacity of two of them. Off: measured on the TV
 * (2026-11-16) even that drops it to 22 fps with a 233 ms stall after each press, against 60 fps
 * and 17 ms without it. Any full-screen layer that changes on a key press costs this much.
 */
export const AMBIENT_WASH = false;

const DIRECTIONS: Record<number, Direction> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
const KEY_ENTER = 13;
/** Back on the TV remote; Escape does the same in a desktop browser. */
const KEYS_BACK = [10009, 27];
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
  pictures:
    '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><rect x="5" y="14" width="27" height="22" rx="2"/><path d="M16 10h25a2 2 0 0 1 2 2v19"/><path d="M9 31l7-7 6 6 4-4 6 6"/></svg>',
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
  /** Swap in a new catalog. Does nothing when the tiles are the same; otherwise rebuilds in place, keeping the focus. */
  update(catalog: Catalog): void;
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
    img.addEventListener('load', () => queueIcon(() => placeIcon(img, face)));
    img.src = tile.iconUrl;
    face.append(img);
  }
  node.append(face);
  return node;
}

// Sampling an icon reads its pixels back, which is slow on the TV. It waits until the first
// frame is on screen, then runs one icon at a time between frames.
let iconsReleased = false;
let draining = false;
const iconJobs: Array<() => void> = [];

function drainIcons(): void {
  if (draining) return;
  draining = true;
  const next = (): void => {
    const job = iconJobs.shift();
    if (!job) {
      draining = false;
      return;
    }
    job();
    window.setTimeout(next, 16);
  };
  window.setTimeout(next, 0);
}

function queueIcon(job: () => void): void {
  iconJobs.push(job);
  if (iconsReleased) drainIcons();
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
  // The icon carries the app's own logo, so the name underneath must not show through it.
  face.classList.add('has-icon');
}

/**
 * How long a key press takes to reach the screen, read over the debug port as
 * `window.__frameHomeLag` (the last 50 presses). All times in ms from the key event:
 * queue = until our handler ran, handler = its own time, frame = until the second frame after it
 * (the first one that can show the change), fps and worstGap = the 500 ms of animation after it.
 */
interface LagSample {
  queue: number;
  handler: number;
  frame: number;
  fps: number;
  worstGap: number;
}
const lagSamples: LagSample[] = [];
(window as unknown as { __frameHomeLag: LagSample[] }).__frameHomeLag = lagSamples;

function measureLag(eventAt: number, handlerStart: number, handlerEnd: number): void {
  requestAnimationFrame(() =>
    requestAnimationFrame((firstShown) => {
      const sample: LagSample = {
        queue: Math.round(handlerStart - eventAt),
        handler: Math.round(handlerEnd - handlerStart),
        frame: Math.round(performance.now() - eventAt),
        fps: 0,
        worstGap: 0,
      };
      let last = firstShown;
      let frames = 0;
      const step = (now: number): void => {
        frames++;
        sample.worstGap = Math.max(sample.worstGap, Math.round(now - last));
        last = now;
        if (now - firstShown < 500) {
          requestAnimationFrame(step);
          return;
        }
        sample.fps = Math.round((frames * 1000) / (now - firstShown));
        lagSamples.push(sample);
        if (lagSamples.length > 50) lagSamples.shift();
      };
      requestAnimationFrame(step);
    }),
  );
}

function readSavedFocus(): FocusPos | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_FOCUS) ?? 'null');
    return saved && Number.isInteger(saved.row) && Number.isInteger(saved.col) ? saved : null;
  } catch {
    return null;
  }
}


/** One screen of tiles: its rows, their nodes, and where the tiles sit (measured once it is on the page). */
interface View {
  rows: Row[];
  container: HTMLElement;
  nodes: HTMLElement[][];
  model: FocusRow[] | null;
}

function buildView(rows: Row[]): View {
  const container = el('div', 'rows');
  const nodes = rows.map((row) => {
    const rowNode = el('div', `row row-${row.kind}`);
    const tiles = row.tiles.map((tile) => tileNode(tile, row.kind));
    rowNode.append(...tiles);
    container.append(rowNode);
    return tiles;
  });
  return { rows, container, nodes, model: null };
}

/** Tile centres, measured once from the laid-out page. Transforms do not affect them. */
function ensureModel(view: View): FocusRow[] {
  view.model ??= view.nodes.map((tiles) => ({ centers: tiles.map((t) => t.offsetLeft + t.offsetWidth / 2) }));
  return view.model;
}

const tileKey = (tile: Tile): string => `${tile.appId}|${tile.name}`;

/** What the screen shows, so a fresh app list that changes nothing does not rebuild anything. */
function signature(catalog: Catalog): string {
  return [...catalog.rows, ...catalog.all].map((r) => r.tiles.map((t) => `${tileKey(t)}|${t.iconUrl ?? ''}`).join(',')).join(';');
}

function findTile(rows: Row[], key: string): FocusPos | null {
  for (let row = 0; row < rows.length; row++) {
    const col = rows[row].tiles.findIndex((t) => tileKey(t) === key);
    if (col >= 0) return { row, col };
  }
  return null;
}

const hexToRgba = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export function mountHome(root: HTMLElement, initial: Catalog, options: HomeOptions): Home {
  const stage = el('div', 'stage');
  const washHost = el('div', 'washes');
  const clock = el('div', 'clock');
  const content = el('div', 'content');
  const hero = el('div', 'hero');
  const heroName = el('h1', 'hero-name');
  const heroLine = el('p', 'hero-line');
  const noteNode = el('div', 'note');
  hero.append(heroName, heroLine);
  stage.append(washHost, content, clock, noteNode);
  root.replaceChildren(stage);

  let catalog = initial;
  let seen = signature(catalog);
  let home = buildView(catalog.rows);
  let all: View | null = null;
  let mode: 'home' | 'all' = 'home';
  content.append(hero, home.container);
  const current = (): View => (mode === 'home' ? home : all!);

  // The ambient wash: one layer per glow colour, made when the colour first appears and never
  // changed after. Only which layer is on changes.
  const washes = new Map<string, HTMLElement>();
  let washOn: HTMLElement | null = null;
  function syncWashes(): void {
    if (!AMBIENT_WASH) return;
    for (const row of [...catalog.rows, ...catalog.all]) {
      for (const tile of row.tiles) {
        if (washes.has(tile.glow)) continue;
        const layer = el('div', 'wash');
        layer.style.setProperty('--wash-a', hexToRgba(tile.glow, 0.46));
        layer.style.setProperty('--wash-b', hexToRgba(tile.glow, 0.2));
        washes.set(tile.glow, layer);
        washHost.append(layer);
      }
    }
  }
  function setWash(glow: string): void {
    const next = washes.get(glow) ?? null;
    if (next === washOn) return;
    washOn?.classList.remove('is-on');
    next?.classList.add('is-on');
    washOn = next;
  }

  let focus: FocusPos | null = null;
  /** The focus on the home rows; while All apps is open, it is the All apps tile. */
  let homeFocus: FocusPos | null = null;
  let shift = 0;

  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };

  function show(pos: FocusPos): void {
    const view = current();
    if (focus) view.nodes[focus.row]?.[focus.col]?.classList.remove('is-focused');
    focus = pos;
    if (mode === 'home') homeFocus = pos;
    const tile = view.rows[pos.row].tiles[pos.col];
    view.nodes[pos.row][pos.col].classList.add('is-focused');

    if (mode === 'home') {
      setText(heroName, tile.name);
      setText(heroLine, tile.line);
    } else {
      setText(heroName, 'All apps');
      setText(heroLine, tile.name);
    }

    // Rows past the third sit below the screen; slide the page up to bring the focused one in.
    const hiddenRows = Math.max(0, pos.row - (ROWS_ON_SCREEN - 1));
    if (hiddenRows !== shift) {
      shift = hiddenRows;
      content.style.transform = `translateY(${-hiddenRows * ROW_STEP}px)`;
    }

    setWash(tile.glow);
  }

  /** Put a view on the page in place of the one showing, and focus `pos` (or the nearest tile) in it. */
  function swapTo(view: View, previous: View, pos: FocusPos | null): void {
    if (previous.container.parentNode === content) content.replaceChild(view.container, previous.container);
    else content.append(view.container);
    focus = null;
    const start = pos && clampPos(ensureModel(view), pos);
    if (start) show(start);
  }

  function enterAll(): void {
    if (!catalog.all.length) {
      note('There are no other apps');
      return;
    }
    all = buildView(catalog.all);
    mode = 'all';
    swapTo(all, home, { row: 0, col: 0 });
  }

  function exitAll(): void {
    if (mode !== 'all' || !all) return;
    const previous = all;
    mode = 'home';
    all = null;
    swapTo(home, previous, homeFocus);
  }

  syncWashes();
  // Start where the user left off; the first time, on the first app tile.
  const firstApps = Math.max(0, home.rows.findIndex((r) => r.kind === 'apps'));
  const start = clampPos(ensureModel(home), readSavedFocus() ?? { row: firstApps, col: 0 });
  if (start) show(start);

  // Until the first frame is out, icons only load; then they are sampled one at a time.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      iconsReleased = true;
      drainIcons();
    }),
  );

  // The focus position is written when the page goes away, never on a key press.
  function saveFocus(): void {
    if (!homeFocus) return;
    try {
      localStorage.setItem(SAVED_FOCUS, JSON.stringify(homeFocus));
    } catch {
      // Storage being unavailable only costs the remembered position.
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveFocus();
  });
  window.addEventListener('pagehide', saveFocus);

  document.addEventListener('keydown', (event) => {
    if (KEYS_BACK.includes(event.keyCode)) {
      // On the home rows Back does nothing: it must never close the launcher.
      event.preventDefault();
      if (mode === 'all') exitAll();
      return;
    }
    if (!focus) return;
    const dir = DIRECTIONS[event.keyCode];
    if (dir) {
      event.preventDefault();
      const handlerStart = performance.now();
      const next = move(ensureModel(current()), focus, dir);
      if (next.row !== focus.row || next.col !== focus.col) show(next);
      measureLag(event.timeStamp, handlerStart, performance.now());
      return;
    }
    if (event.keyCode === KEY_ENTER) {
      event.preventDefault();
      const view = current();
      const node = view.nodes[focus.row][focus.col];
      node.classList.add('is-pressed');
      window.setTimeout(() => node.classList.remove('is-pressed'), 140);
      const tile = view.rows[focus.row].tiles[focus.col];
      if (tile.appId === ALL_APPS_ID) enterAll();
      else options.onOpen(tile);
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
  function note(text: string): void {
    noteNode.textContent = text;
    noteNode.classList.add('is-on');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => noteNode.classList.remove('is-on'), 4000);
  }

  return {
    note,
    update(next: Catalog): void {
      const sig = signature(next);
      if (sig === seen) return;
      seen = sig;
      // Where the focus is, by tile rather than by position: the rows may have shifted.
      const view = current();
      const focused = focus ? tileKey(view.rows[focus.row].tiles[focus.col]) : null;
      const homeKey = mode === 'home' ? focused : ALL_APPS_ID;
      catalog = next;
      syncWashes();

      const oldHome = home;
      home = buildView(catalog.rows);
      const homePos = (homeKey && findTile(home.rows, homeKey)) || homeFocus;
      if (mode === 'home') {
        swapTo(home, oldHome, homePos);
        return;
      }
      homeFocus = homePos;
      // All apps is open: rebuild it where it stands, or close it when nothing is left.
      const oldAll = all!;
      const pos = (focused && findTile(catalog.all, focused)) || focus;
      if (!catalog.all.length) {
        mode = 'home';
        all = null;
        swapTo(home, oldAll, homeFocus);
        return;
      }
      all = buildView(catalog.all);
      swapTo(all, oldAll, pos);
    },
  };
}
