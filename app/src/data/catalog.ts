// The launcher's own curated app list and tile artwork.
// The TV reports 526 "apps", most of them system parts, and many icons do not load
// (docs/phase0-findings.md), so the launcher decides what to show and how each tile looks.
import type { TvApp } from '../platform/tv';

export type Glyph = 'frame' | 'pictures' | 'sliders';

export interface Tile {
  appId: string;
  name: string;
  /** One plain line shown under the name while the tile has the focus. */
  line: string;
  /** The launcher's own tile artwork: a two-colour ground and an ink colour for the name. */
  from: string;
  to: string;
  ink: string;
  /** Colour of the ambient wash behind the screen while the tile has the focus. */
  glow: string;
  /** The TV's own icon for the app, laid over the artwork when it loads. */
  iconUrl: string | null;
  glyph?: Glyph;
}

export interface Row {
  kind: 'frame' | 'apps';
  tiles: Tile[];
}

/** A tile as the launcher defines it; `requires` names the TV app it needs when its own id is not one. */
type Known = Omit<Tile, 'iconUrl'> & { requires?: string };

/** The tile that opens the Choose art screen (app/src/ui/picker.ts). The launcher handles it itself. */
export const CHOOSE_ART_ID = 'frame-home:choose-art';

// The Frame's own features. Tested on the TV: the Art app opens; `org.tizen.menu` opens as an
// overlay that takes the focus. Samsung's art picker (`com.samsung.tv.home.art`) refuses to be
// opened by an app, and `com.samsung.tv.coba.setting` opens nothing.
// "Choose art" is the launcher's own picture grid: the keeper caches the pictures whenever Art Mode
// answers, and shows the chosen one when Art Mode next comes on.
const FRAME: Known[] = [
  { appId: 'org.tizen.art-app', name: 'Art Mode', line: 'Show the artwork now', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#B9A88A', glyph: 'frame' },
  { appId: CHOOSE_ART_ID, requires: 'org.tizen.art-app', name: 'Choose art', line: 'Pick what the Frame shows', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#A8937A', glyph: 'pictures' },
  { appId: 'org.tizen.menu', name: 'Settings', line: 'All of the TV’s settings', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#7F8AA3', glyph: 'sliders' },
];

// TV inputs, opened through Samsung's own full-screen input view (app/src/platform/tizen.ts).
// Always shown: a console in rest mode is off the TV's input list, yet opening its input wakes it.
const INPUTS: Known[] = [
  { appId: 'input:HDMI3', name: 'PlayStation 5', line: 'HDMI 3', from: '#00296B', to: '#0070D1', ink: '#FFFFFF', glow: '#2C7BFF' },
];

// A row holds six tiles at most; there is no sideways scrolling.
const DOCK: Known[] = [
  { appId: 'org.tizen.netflix-app', name: 'Netflix', line: '', from: '#2A0A0D', to: '#0E0C10', ink: '#E50914', glow: '#E50914' },
  { appId: 'org.tizen.primevideo', name: 'Prime Video', line: '', from: '#0E3A5C', to: '#0B6FB3', ink: '#FFFFFF', glow: '#1A98FF' },
  { appId: 'com.samsung.tv.aria-video', name: 'Apple TV', line: '', from: '#2B2B30', to: '#111114', ink: '#F3EFE8', glow: '#8E8E99' },
  { appId: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', line: '', from: '#071A4A', to: '#0E3CAF', ink: '#FFFFFF', glow: '#2C5BFF' },
  { appId: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', line: '', from: '#FFFFFF', to: '#E9E6EE', ink: '#17151A', glow: '#FF3B3B' },
];

const NEXT: Known[] = [
  { appId: 'rJeHak5zRg.Spotify', name: 'Spotify', line: '', from: '#10231A', to: '#0C0F0D', ink: '#1ED760', glow: '#1ED760' },
  { appId: 'com.samsung.tv.SmartThingsApp', name: 'SmartThings', line: '', from: '#0C56C9', to: '#22A3F2', ink: '#FFFFFF', glow: '#22A3F2' },
  { appId: 'kupCeIdDkX.HueSync', name: 'Hue Sync', line: '', from: '#3B1D4F', to: '#C2466A', ink: '#FFFFFF', glow: '#E0567F' },
];

/** The tile that opens the All apps screen. It is not an app: the launcher handles it itself. */
export const ALL_APPS_ID = 'frame-home:all-apps';
const ALL_APPS: Known = { appId: ALL_APPS_ID, name: 'All apps', line: 'Everything else', from: '#3A3446', to: '#1F1C27', ink: '#F3EFE8', glow: '#9A8FB8' };

// Everything that has no tile on the home screen goes to the All apps screen.
const REST: Known[] = [
  { appId: 'GHI3a0zMSx.XboxGamePass', name: 'Xbox', line: '', from: '#0E5C0E', to: '#0A3D0A', ink: '#FFFFFF', glow: '#3FBF3F' },
  { appId: 'com.samsung.tv.gaminghub', name: 'Gaming Hub', line: '', from: '#2B1B5E', to: '#5B3FD1', ink: '#FFFFFF', glow: '#7B5CFF' },
  { appId: 'org.tizen.browser', name: 'Internet', line: '', from: '#2D3142', to: '#1C1F2B', ink: '#F3EFE8', glow: '#7D8BB0' },
  { appId: 'com.samsung.tv.store', name: 'Apps', line: 'Samsung app store', from: '#34313B', to: '#24212A', ink: '#F3EFE8', glow: '#A9A3B2' },
];

/** Tiles per row; six of them fill the 1920-wide screen. */
export const PER_ROW = 6;

// Store apps look like "MCmYXNxgcu.DisneyPlus". These ones are not worth a tile.
const STORE_APP = /^[A-Za-z0-9]{10}\.[\w.-]+$/;
const NEVER = new Set(['w2VwCK465D.OTApp', '2025ePop01.SmartTV', '25emanual2.emanual', 'adplatform.ADPlayer', 'tv6pbVMQFF.PrivacyChoices', 'ByJlgt0XeD.CastSettingsApp']);
const OURS = /^(FrameHome1|FrmHmPrb01)\./;

const CURATED = new Set([...FRAME, ...INPUTS, ...DOCK, ...NEXT, ...REST].map((k) => k.requires ?? k.appId));

/** True for apps that get a tile, curated or from the store; the rest of the TV's list is never looked at. */
function wanted(a: TvApp): boolean {
  return CURATED.has(a.id) || (a.shown && STORE_APP.test(a.id) && !NEVER.has(a.id) && !OURS.test(a.id));
}

/** The part of the TV's app list that can change the tiles, for the launcher's cache (about 30 of 500+ entries). */
export function relevantApps(installed: TvApp[]): TvApp[] {
  return installed.filter(wanted).map((a) => ({ id: a.id, name: a.name, shown: a.shown, iconUrl: a.iconUrl }));
}

export interface Catalog {
  /** The home screen: the Frame row, the main apps, then the next row. */
  rows: Row[];
  /** The All apps screen, in rows of PER_ROW. */
  all: Row[];
}

/**
 * @param installed the TV's app list, or null when it is not known yet: the curated apps are
 *   then assumed installed, so the home screen can be drawn before the TV answers.
 */
export function buildCatalog(installed: TvApp[] | null): Catalog {
  const byId = new Map((installed ?? []).map((a) => [a.id, a]));
  const present = (list: Known[]): Tile[] =>
    list
      .filter((k) => installed === null || byId.has(k.requires ?? k.appId))
      .map(({ requires: _requires, ...k }) => ({ ...k, iconUrl: byId.get(k.appId)?.iconUrl ?? null }));
  const plain = (list: Known[]): Tile[] => present(list).map((t) => ({ ...t, iconUrl: null }));

  // Anything installed from the store later still gets a tile, with the TV's own name and icon.
  // The TV also lists store-style ids for background services; `shown` separates the two.
  const extra: Tile[] = (installed ?? [])
    .filter((a) => a.shown && wanted(a) && !CURATED.has(a.id))
    .map((a) => ({ appId: a.id, name: a.name, line: '', from: '#34313B', to: '#24212A', ink: '#F3EFE8', glow: '#A9A3B2', iconUrl: a.iconUrl }));

  const rows: Row[] = [
    { kind: 'frame', tiles: plain(FRAME) },
    // The console first in the main row, and always there.
    { kind: 'apps', tiles: [...INPUTS.map((k) => ({ ...k, iconUrl: null })), ...present(DOCK)] },
    { kind: 'apps', tiles: [...present(NEXT), { ...ALL_APPS, iconUrl: null }] },
  ];

  const rest = [...present(REST), ...extra];
  const all: Row[] = [];
  for (let i = 0; i < rest.length; i += PER_ROW) all.push({ kind: 'apps', tiles: rest.slice(i, i + PER_ROW) });
  return { rows: rows.filter((r) => r.tiles.length > 0), all };
}
