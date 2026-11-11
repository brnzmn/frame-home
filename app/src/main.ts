import './styles.css';
import { buildRows } from './data/catalog';
import { justJumpedBack, startLifecycle, trace } from './lifecycle';
import { connectTv } from './platform/tv';
import { mountHome } from './ui/home';

async function start(): Promise<void> {
  trace('launcher started');
  const tv = connectTv();
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

  if (!rows.length) home.note('The TV did not return its app list');
  else if (justJumpedBack()) home.note('Press Home again for Samsung’s home');
}

void start();
