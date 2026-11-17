import type { ArtItem, Tv, TvApp } from './tv';

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

// Stand-in pictures for the Choose art screen: small painted SVGs, nothing from the TV.
// `?art=empty` shows the first-use screen, `?art=off` a keeper that does not answer.
const PALETTES = [
  ['#2E3B55', '#C9A66B', '#E8E1D3'],
  ['#5B2A3C', '#E07A5F', '#F2CC8F'],
  ['#1F4E5F', '#7FB7BE', '#EAD7C3'],
  ['#3D3B30', '#A3A380', '#D6CE93'],
  ['#14213D', '#FCA311', '#E5E5E5'],
  ['#4A3B52', '#B49FCC', '#EAD7D7'],
  ['#264027', '#6F732F', '#B38A58'],
  ['#2B2D42', '#8D99AE', '#EF233C'],
];

function painting(i: number): string {
  const [ground, mid, light] = PALETTES[i % PALETTES.length];
  const x = 60 + ((i * 53) % 180);
  const y = 50 + ((i * 37) % 70);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ground}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>` +
    `<rect width="320" height="180" fill="url(#g)"/>` +
    `<circle cx="${x}" cy="${y}" r="${26 + (i % 4) * 8}" fill="${light}" opacity="0.85"/>` +
    `<path d="M0 ${130 + (i % 3) * 10} Q 110 ${100 + (i % 5) * 8} 200 ${140 - (i % 4) * 6} T 320 ${120 + (i % 3) * 12} V180 H0Z" fill="${ground}" opacity="0.8"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function mockArt(): ArtItem[] | null {
  const mode = new URLSearchParams(location.search).get('art');
  if (mode === 'off') return null;
  if (mode === 'empty') return [];
  const mine = Array.from({ length: 9 }, (_, i): ArtItem => ({ id: `MY_F00${String(i + 1).padStart(2, '0')}`, kind: 'mine', thumbUrl: painting(i) }));
  const store = Array.from({ length: 8 }, (_, i): ArtItem => ({ id: `SAM-S00${i + 1}`, kind: 'store', thumbUrl: i === 7 ? null : painting(i + 9) }));
  return [...mine, ...store];
}

export function createMockTv(): Tv {
  return {
    kind: 'mock',
    appId: null,
    installedApps: async () => INSTALLED,
    open: async (appId) => {
      console.info(`[fake TV] would open ${appId}`);
    },
    runningAppIds: async () => [],
    foregroundAppId: () => null,
    startedBy: () => 'browser',
    bringToFront: async () => {},
    startKeeper: async () => {},
    keeperAnswers: async () => true,
    sleepNoticeAge: async () => null,
    artList: async () => mockArt(),
    chooseArt: async (id) => {
      console.info(`[fake TV] would show ${id} once Art Mode answers`);
      return true;
    },
    noteToKeeper: () => {},
    connectedInputs: async () => null,
    stepAside: () => {},
  };
}
