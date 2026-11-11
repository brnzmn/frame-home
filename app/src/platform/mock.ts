import type { Tv, TvApp } from './tv';

// The apps found on the Frame Pro on 2026-11-10 (docs/probe-report.json), without icons,
// so the browser preview shows the launcher's own tile artwork.
const INSTALLED: TvApp[] = [
  ['org.tizen.art-app', 'ArtApp'],
  ['org.tizen.menu', 'org.tizen.menu'],
  ['com.samsung.tv.quickpanel', 'QuickPanel'],
  ['org.tizen.netflix-app', 'Netflix'],
  ['9Ur5IzDKqV.TizenYouTube', 'YouTube'],
  ['org.tizen.primevideo', 'Prime Video'],
  ['MCmYXNxgcu.DisneyPlus', 'Disney+'],
  ['com.samsung.tv.aria-video', 'Apple TV'],
  ['rJeHak5zRg.Spotify', 'Spotify - Music and Podcasts'],
  ['GHI3a0zMSx.XboxGamePass', 'Xbox'],
  ['com.samsung.tv.gaminghub', 'GamingHub'],
  ['kupCeIdDkX.HueSync', 'Hue Sync'],
  ['com.samsung.tv.SmartThingsApp', 'SmartThings'],
  ['org.tizen.browser', 'Internet'],
  ['com.samsung.tv.store', 'Apps'],
  ['WSRedi0001.WorkspaceRedi', 'Workspace'],
].map(([id, name]) => ({ id, name, shown: true, iconUrl: null }));

export function createMockTv(): Tv {
  return {
    kind: 'mock',
    installedApps: async () => INSTALLED,
    open: async (appId) => {
      console.info(`[fake TV] would open ${appId}`);
    },
    runningAppIds: async () => [],
    foregroundAppId: () => null,
    bringToFront: async () => {},
  };
}
