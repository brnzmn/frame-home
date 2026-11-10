import './styles.css';
import { buildRows } from './data/catalog';
import { startLifecycle } from './lifecycle';
import { connectTv } from './platform/tv';
import { mountHome } from './ui/home';

async function start(): Promise<void> {
  const tv = connectTv();
  const installed = await tv.installedApps().catch(() => []);
  const rows = buildRows(installed);
  // Coming back over Samsung's home works on the TV but stays off until there is a setting for it.
  const lifecycle = startLifecycle(tv, { returnOverSamsungHome: false });

  const home = mountHome(document.getElementById('app')!, rows, {
    fitToWindow: tv.kind === 'mock',
    onOpen: (tile) => {
      lifecycle.opened(tile.appId);
      tv.open(tile.appId).catch(() => home.note(`Could not open ${tile.name}`));
    },
  });

  if (!rows.length) home.note('The TV did not return its app list');
}

void start();
