#!/usr/bin/env node
// Watches from the Mac whether the launcher is on screen, using the TV's public app-status page.
// Prints a line each time that changes. Works when the debug port does not (it drops whenever
// the launcher is hidden).
//
//   node tools/watch-launcher.mjs [seconds]     default 30
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tv = JSON.parse(fs.readFileSync(path.join(root, '.tv.json'), 'utf8'));
const seconds = Number(process.argv[2] ?? 30);
const url = `http://${tv.ip}:8001/api/v2/applications/FrameHome1.FrameHome`;
const start = Date.now();
let last = '';

const clock = () => new Date().toTimeString().slice(0, 8);

while (Date.now() - start < seconds * 1000) {
  let state;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    state = j.code ? 'not running' : j.visible ? 'on screen' : 'running, hidden';
  } catch {
    state = 'TV not answering';
  }
  if (state !== last) {
    console.log(`${clock()} +${((Date.now() - start) / 1000).toFixed(1)}s launcher ${state}`);
    last = state;
  }
  await new Promise((r) => setTimeout(r, 400));
}
