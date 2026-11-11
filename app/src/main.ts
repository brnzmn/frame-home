import './styles.css';
import { buildRows } from './data/catalog';
import { copyTraceTo, justJumpedBack, startLifecycle, trace } from './lifecycle';
import { connectTv } from './platform/tv';
import { mountHome } from './ui/home';

async function start(): Promise<void> {
  const tv = connectTv();
  copyTraceTo((event) => tv.noteToKeeper(event));
  trace(`launcher started ${document.visibilityState}; ${tv.startedBy()}`);
  // The second line: if this page is stopped, the keeper opens it again after Art Mode.
  tv.startKeeper().then(
    () => trace('keeper: start accepted'),
    (e: Error) => trace(`keeper: ${e.message}`),
  );
  const installed = await tv.installedApps().catch(() => []);
  const rows = buildRows(installed);
  // Baran's choice, 2026-11-11: jump back over Samsung's home, with no change to the TV's system.
  const lifecycle = startLifecycle(tv, { returnOverSamsungHome: true });

  const home = mountHome(document.getElementById('app')!, rows, {
    fitToWindow: tv.kind === 'mock',
    onOpen: (tile) => {
      lifecycle.opened(tile.appId);
      tv.open(tile.appId).catch(() => home.note(`Could not open ${tile.name}`));
    },
  });

  const hint = (): void => {
    if (justJumpedBack()) home.note('Press Home again for Samsung’s home');
  };
  if (!rows.length) home.note('The TV did not return its app list');
  else hint();
  // Coming back does not restart the page; show the hint each time the launcher reappears.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') hint();
  });
}

void start();
