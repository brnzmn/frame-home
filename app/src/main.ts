import './styles.css';
import { ALL_APPS_ID, buildCatalog, relevantApps } from './data/catalog';
import { copyTraceTo, justJumpedBack, startLifecycle, trace } from './lifecycle';
import { connectTv, type TvApp } from './platform/tv';
import { mountHome } from './ui/home';

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
      // The All apps tile is the launcher's own screen, not an app on the TV.
      if (tile.appId === ALL_APPS_ID) return;
      lifecycle.opened(tile.appId);
      tv.open(tile.appId).catch(() => home.note(`Could not open ${tile.name}`));
    },
  });

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
