import { describe, expect, it } from 'vitest';
import type { TvApp } from '../platform/tv';
import { ALL_APPS_ID, buildCatalog, CHOOSE_ART_ID, PER_ROW, relevantApps } from './catalog';

const app = (id: string, name = id, shown = true): TvApp => ({ id, name, shown, iconUrl: null });

// Everything the owner's list names, plus the rest of what the TV carries.
const CURATED_IDS = [
  'org.tizen.art-app',
  'org.tizen.menu',
  'org.tizen.netflix-app',
  'org.tizen.primevideo',
  'com.samsung.tv.aria-video',
  'MCmYXNxgcu.DisneyPlus',
  'com.samsung.tv.SmartThingsApp',
  'kupCeIdDkX.HueSync',
  '9Ur5IzDKqV.TizenYouTube',
  'rJeHak5zRg.Spotify',
  'GHI3a0zMSx.XboxGamePass',
  'com.samsung.tv.gaminghub',
  'org.tizen.browser',
  'com.samsung.tv.store',
];
const installed = CURATED_IDS.map((id) => app(id));
const names = (rows: { tiles: { name: string }[] }[]): string[][] => rows.map((r) => r.tiles.map((t) => t.name));

describe('buildCatalog', () => {
  it('lays out the Frame row, the main apps and the next row in order', () => {
    const { rows } = buildCatalog(installed);
    expect(rows.map((r) => r.kind)).toEqual(['frame', 'apps', 'apps']);
    expect(names(rows)).toEqual([
      ['Art Mode', 'Choose art', 'Settings'],
      ['PlayStation 5', 'Netflix', 'Prime Video', 'Apple TV', 'Disney+', 'YouTube'],
      ['Spotify', 'SmartThings', 'Hue Sync', 'All apps'],
    ]);
    expect(rows[0].tiles.map((t) => t.appId)).toEqual(['org.tizen.art-app', CHOOSE_ART_ID, 'org.tizen.menu']);
  });

  it('has a Choose art card that opens the launcher\'s own picture screen, next to an unchanged Art Mode', () => {
    const [artMode, choose] = buildCatalog(installed).rows[0].tiles;
    expect(artMode).toMatchObject({ appId: 'org.tizen.art-app', name: 'Art Mode', line: 'Show the artwork now', glyph: 'frame' });
    expect(choose).toMatchObject({ appId: CHOOSE_ART_ID, name: 'Choose art', line: 'Pick what the Frame shows', glyph: 'pictures' });
    expect('requires' in choose).toBe(false);
    // It needs the Art app on the TV, like the Art Mode card.
    expect(buildCatalog([app('org.tizen.menu')]).rows[0].tiles.map((t) => t.name)).toEqual(['Settings']);
  });

  it('puts everything else on the All apps screen, in rows of six', () => {
    const { all } = buildCatalog([...installed, ...Array.from({ length: 4 }, (_, i) => app(`abcdefghi${i}.Extra${i}`, `Extra ${i}`))]);
    expect(names(all)).toEqual([
      ['Xbox', 'Gaming Hub', 'Internet', 'Apps', 'Extra 0', 'Extra 1'],
      ['Extra 2', 'Extra 3'],
    ]);
    expect(all.every((r) => r.tiles.length <= PER_ROW)).toBe(true);
    const ids = new Set(buildCatalog(installed).rows.flatMap((r) => r.tiles.map((t) => t.appId)));
    expect(all.flatMap((r) => r.tiles).some((t) => ids.has(t.appId))).toBe(false);
  });

  it('has an All apps tile that is not an app on the TV', () => {
    const { tiles } = buildCatalog(installed).rows[2];
    const tile = tiles[tiles.length - 1];
    expect(tile).toMatchObject({ appId: ALL_APPS_ID, name: 'All apps', line: 'Everything else' });
  });

  it('keeps the PlayStation 5 tile first in the main row, installed or not', () => {
    for (const list of [installed, [], [app('org.tizen.netflix-app')]]) {
      const main = buildCatalog(list).rows.find((r) => r.tiles[0]?.appId === 'input:HDMI3');
      expect(main).toBeDefined();
      expect(main!.tiles[0]).toMatchObject({ name: 'PlayStation 5', line: 'HDMI 3', from: '#00296B', to: '#0070D1', glow: '#2C7BFF' });
    }
  });

  it('hides apps that are not installed', () => {
    const { rows, all } = buildCatalog([app('org.tizen.art-app'), app('org.tizen.netflix-app'), app('rJeHak5zRg.Spotify')]);
    expect(names(rows)).toEqual([['Art Mode', 'Choose art'], ['PlayStation 5', 'Netflix'], ['Spotify', 'All apps']]);
    expect(names(all)).toEqual([]);
  });

  it('gives other store apps a tile on All apps, and skips services, ours and the excluded', () => {
    const { all } = buildCatalog([
      app('abcdefghij.Podcasts', 'Podcasts'),
      app('abcdefghij.Service', 'Service', false),
      app('w2VwCK465D.OTApp', 'OT'),
      app('FrameHome1.Launcher', 'Frame Home'),
      app('com.samsung.tv.something', 'System thing'),
    ]);
    expect(names(all)).toEqual([['Podcasts']]);
  });

  it('assumes the curated apps are installed when the list is not known yet', () => {
    const { rows, all } = buildCatalog(null);
    expect(names(rows)).toEqual(names(buildCatalog(installed).rows));
    expect(names(all)).toEqual([['Xbox', 'Gaming Hub', 'Internet', 'Apps']]);
  });

  it('no longer has Quick settings or Art settings', () => {
    const everything = [...buildCatalog(null).rows, ...buildCatalog(null).all].flatMap((r) => r.tiles.map((t) => t.name));
    expect(everything).not.toContain('Quick settings');
    expect(everything).not.toContain('Art settings');
  });
});

describe('relevantApps', () => {
  it('keeps only what can change a tile, with the four cached fields, and rebuilds the same tiles', () => {
    const noise = Array.from({ length: 300 }, (_, i) => app(`com.samsung.tv.part${i}`, `Part ${i}`));
    const list = [...noise, ...installed, app('abcdefghij.Podcasts', 'Podcasts')];
    const kept = relevantApps(list);
    expect(kept).toHaveLength(installed.length + 1);
    expect(Object.keys(kept[0]).sort()).toEqual(['iconUrl', 'id', 'name', 'shown']);
    expect(buildCatalog(kept)).toEqual(buildCatalog(list));
  });
});
