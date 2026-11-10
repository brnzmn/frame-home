// The launcher's own curated app list and tile artwork.
// The TV reports 526 "apps", most of them system parts, and many icons do not load
// (docs/phase0-findings.md), so the launcher decides what to show and how each tile looks.
import type { TvApp } from '../platform/tv';

export type Glyph = 'frame' | 'sliders' | 'toggles';

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

type Known = Omit<Tile, 'iconUrl'>;

// The Frame's own features. Tested on the TV: the Art app opens; `org.tizen.menu` and the quick
// panel open as overlays that take the focus. Samsung's art picker (`com.samsung.tv.home.art`)
// refuses to be opened by an app, and `com.samsung.tv.coba.setting` opens nothing.
const FRAME: Known[] = [
  { appId: 'org.tizen.art-app', name: 'Art Mode', line: 'Show the artwork now', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#B9A88A', glyph: 'frame' },
  { appId: 'org.tizen.menu', name: 'Settings', line: 'All of the TV’s settings', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#7F8AA3', glyph: 'sliders' },
  { appId: 'com.samsung.tv.quickpanel', name: 'Quick settings', line: 'Samsung’s quick panel', from: '#E8E1D3', to: '#D6CCB9', ink: '#1B1820', glow: '#9C8FB0', glyph: 'toggles' },
];

const DOCK: Known[] = [
  { appId: 'org.tizen.netflix-app', name: 'Netflix', line: '', from: '#2A0A0D', to: '#0E0C10', ink: '#E50914', glow: '#E50914' },
  { appId: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', line: '', from: '#FFFFFF', to: '#E9E6EE', ink: '#17151A', glow: '#FF3B3B' },
  { appId: 'org.tizen.primevideo', name: 'Prime Video', line: '', from: '#0E3A5C', to: '#0B6FB3', ink: '#FFFFFF', glow: '#1A98FF' },
  { appId: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+', line: '', from: '#071A4A', to: '#0E3CAF', ink: '#FFFFFF', glow: '#2C5BFF' },
  { appId: 'com.samsung.tv.aria-video', name: 'Apple TV', line: '', from: '#2B2B30', to: '#111114', ink: '#F3EFE8', glow: '#8E8E99' },
  { appId: 'rJeHak5zRg.Spotify', name: 'Spotify', line: '', from: '#10231A', to: '#0C0F0D', ink: '#1ED760', glow: '#1ED760' },
];

const MORE: Known[] = [
  { appId: 'GHI3a0zMSx.XboxGamePass', name: 'Xbox', line: '', from: '#0E5C0E', to: '#0A3D0A', ink: '#FFFFFF', glow: '#3FBF3F' },
  { appId: 'com.samsung.tv.gaminghub', name: 'Gaming Hub', line: '', from: '#2B1B5E', to: '#5B3FD1', ink: '#FFFFFF', glow: '#7B5CFF' },
  { appId: 'kupCeIdDkX.HueSync', name: 'Hue Sync', line: '', from: '#3B1D4F', to: '#C2466A', ink: '#FFFFFF', glow: '#E0567F' },
  { appId: 'com.samsung.tv.SmartThingsApp', name: 'SmartThings', line: '', from: '#0C56C9', to: '#22A3F2', ink: '#FFFFFF', glow: '#22A3F2' },
  { appId: 'org.tizen.browser', name: 'Internet', line: '', from: '#2D3142', to: '#1C1F2B', ink: '#F3EFE8', glow: '#7D8BB0' },
  { appId: 'com.samsung.tv.store', name: 'Apps', line: 'Samsung app store', from: '#34313B', to: '#24212A', ink: '#F3EFE8', glow: '#A9A3B2' },
];

/** Tiles per row; six of them fill the 1920-wide screen. */
export const PER_ROW = 6;

// Store apps look like "MCmYXNxgcu.DisneyPlus". These ones are not worth a tile.
const STORE_APP = /^[A-Za-z0-9]{10}\.[\w.-]+$/;
const NEVER = new Set(['w2VwCK465D.OTApp', '2025ePop01.SmartTV', '25emanual2.emanual', 'adplatform.ADPlayer', 'tv6pbVMQFF.PrivacyChoices', 'ByJlgt0XeD.CastSettingsApp']);
const OURS = /^(FrameHome1|FrmHmPrb01)\./;

export function buildRows(installed: TvApp[]): Row[] {
  const byId = new Map(installed.map((a) => [a.id, a]));
  const present = (list: Known[]): Tile[] =>
    list.filter((k) => byId.has(k.appId)).map((k) => ({ ...k, iconUrl: byId.get(k.appId)?.iconUrl ?? null }));

  const known = new Set([...FRAME, ...DOCK, ...MORE].map((k) => k.appId));
  // Anything installed from the store later still gets a tile, with the TV's own name and icon.
  // The TV also lists store-style ids for background services; `shown` separates the two.
  const extra: Tile[] = installed
    .filter((a) => a.shown && STORE_APP.test(a.id) && !known.has(a.id) && !NEVER.has(a.id) && !OURS.test(a.id))
    .map((a) => ({ appId: a.id, name: a.name, line: '', from: '#34313B', to: '#24212A', ink: '#F3EFE8', glow: '#A9A3B2', iconUrl: a.iconUrl }));

  const more = [...present(MORE), ...extra];
  const rows: Row[] = [
    { kind: 'frame', tiles: present(FRAME).map((t) => ({ ...t, iconUrl: null })) },
    { kind: 'apps', tiles: present(DOCK) },
  ];
  for (let i = 0; i < more.length; i += PER_ROW) rows.push({ kind: 'apps', tiles: more.slice(i, i + PER_ROW) });
  return rows.filter((r) => r.tiles.length > 0);
}
