import './styles.css';
import { ALL_APPS_ID, buildCatalog, CHOOSE_ART_ID, relevantApps } from './data/catalog';
import { ART_APP, copyTraceTo, justJumpedBack, startLifecycle, trace } from './lifecycle';
import { applyLook } from './looks';
import { connectTv, type TvApp } from './platform/tv';
import { mountHome } from './ui/home';

// Which of the three trial looks to show (Step 3 of docs/plan.md): `?look=` in the browser preview,
// or `localStorage['frame-home.look']` on the TV. Nothing set keeps the current look.
const LOOK_KEY = 'frame-home.look';
function chosenLook(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('look');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(LOOK_KEY);
  } catch {
    return null;
  }
}
applyLook(chosenLook());

/** Milliseconds from page start; with the timings below, read over the debug port as `__frameHomeStart`. */
const scriptStart = performance.now();

// The last app list the TV gave. With it the home screen is drawn at once on the next start,
// instead of waiting for the TV to list its 500+ apps. Only the entries that can change a tile are kept.
const APPS_CACHE = 'frame-home.apps';

function readCachedApps(): TvApp[] | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(APPS_CACHE) ?? 'null');
    if (!Array.isArray(saved)) return null;
    return saved
      .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
      .map((a) => ({ id: a.id, name: a.name, shown: a.shown === true, iconUrl: typeof a.iconUrl === 'string' ? a.iconUrl : null }));
  } catch {
    return null;
  }
}

function cacheApps(apps: TvApp[]): void {
  try {
    localStorage.setItem(APPS_CACHE, JSON.stringify(relevantApps(apps)));
  } catch {
    // Without the cache the next start just draws the curated tiles first.
  }
}

async function start(): Promise<void> {
  const tv = connectTv();
  copyTraceTo((event) => tv.noteToKeeper(event));
  trace(`launcher started ${document.visibilityState}; ${tv.startedBy()}`);
  // The keeper listens to the TV's art channel and keeps the record; see its own file.
  tv.startKeeper().then(
    () => trace('keeper: start accepted'),
    (e: Error) => trace(`keeper: ${e.message}`),
  );
  const timing: Record<string, number> = { scriptStart: Math.round(scriptStart) };
  (window as unknown as { __frameHomeStart: Record<string, number> }).__frameHomeStart = timing;
  // Draw from the cached list, or from the curated tiles with every app assumed installed.
  // The TV's own list arrives after the first paint and only rebuilds the rows if it differs.
  const cached = readCachedApps();
  const listing = tv.installedApps(); // asked now, so the TV works on it while the home draws
  // Baran's choice, 2026-11-11: jump back over Samsung's home, with no change to the TV's system.
  const lifecycle = startLifecycle(tv, { returnOverSamsungHome: true });

  const home = mountHome(document.getElementById('app')!, buildCatalog(cached), {
    fitToWindow: tv.kind === 'mock',
    onOpen: (tile) => {
      // All apps and Choose art are the launcher's own screens, not apps on the TV.
      if (tile.appId === ALL_APPS_ID || tile.appId === CHOOSE_ART_ID) return;
      lifecycle.opened(tile.appId);
      tv.open(tile.appId).catch(() => home.note(`Could not open ${tile.name}`));
    },
    loadArt: () => tv.artList(),
    // The art service answers only in Art Mode: the keeper holds the choice, and Art Mode opens
    // from here (which, unlike the power key, leaves the keeper running to send it).
    onChooseArt: async (id) => {
      if (!(await tv.chooseArt(id))) return false;
      trace(`art chosen: ${id}`);
      lifecycle.opened(ART_APP);
      tv.open(ART_APP).catch(() => home.note('Could not open Art Mode'));
      return true;
    },
  });
  // The fake-TV preview opens Choose art straight away with #choose-art, for screenshots.
  if (tv.kind === 'mock' && location.hash === '#choose-art') home.openArt();

  timing.mounted = Math.round(performance.now());
  requestAnimationFrame(() => requestAnimationFrame(() => (timing.drawn = Math.round(performance.now()))));

  listing.then(
    (installed) => {
      timing.appList = Math.round(performance.now());
      if (!installed.length) {
        home.note('The TV did not return its app list');
        return;
      }
      cacheApps(installed);
      home.update(buildCatalog(installed));
    },
    () => home.note('The TV did not return its app list'),
  );

  const hint = (): void => {
    if (justJumpedBack()) home.note('Press Home again for Samsung’s home');
  };
  hint();
  // Coming back does not restart the page; show the hint each time the launcher reappears.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') hint();
  });
}

void start();
