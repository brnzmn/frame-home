#!/usr/bin/env node
// Watches from the Mac what the TV says about itself and about the launcher, using the TV's
// public status pages. Works when the debug port does not (it drops whenever the launcher is
// hidden). The app-status page lags by seconds around app switches: fine for "is it still
// running", useless for timing.
//
//   node tools/watch-launcher.mjs [seconds]
//       quick watch: one line per change, default 30 seconds
//   node tools/watch-launcher.mjs --hours 12 [--every 120] [--log FILE]
//       long watch: one line per reading, also appended to FILE; stops early (exit code 2)
//       once the launcher has stopped running
//   --also APP_ID   also report another app, for "does the launcher outlive it" tests. The TV
//       only answers for store apps (YouTube yes; Netflix, Samsung's home and the Art app no).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tv = JSON.parse(fs.readFileSync(path.join(root, '.tv.json'), 'utf8'));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const hours = Number(flag('--hours') ?? 0);
const long = hours > 0;
const everyMs = long ? Number(flag('--every') ?? 120) * 1000 : 400;
const lengthMs = long ? hours * 3600_000 : Number(args[0] ?? 30) * 1000;
const logFile = flag('--log');
const also = flag('--also');
/** Readings of "not running" in a row before the long watch calls it stopped. */
const STOPPED_AFTER = 3;

const base = `http://${tv.ip}:8001/api/v2/`;
const start = Date.now();

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  return response.json();
}

// The house has two networks and this Mac hops between them; off the TV's one, nothing answers.
function macOnTvNetwork() {
  const prefix = tv.ip.split('.').slice(0, 3).join('.') + '.';
  return Object.values(os.networkInterfaces()).some((addrs) => (addrs ?? []).some((a) => a.family === 'IPv4' && a.address.startsWith(prefix)));
}

const describe = (app) => (app.code || app.running === false ? 'not running' : app.visible ? 'on screen' : 'running, hidden');

async function reading() {
  try {
    const [info, app, other] = await Promise.all([
      getJson(base),
      getJson(`${base}applications/FrameHome1.FrameHome`),
      also ? getJson(`${base}applications/${also}`) : null,
    ]);
    const power = info?.device?.PowerState ?? 'unknown';
    const launcher = describe(app);
    const text = `TV ${power}, launcher ${launcher}${other ? `, ${other.name ?? also} ${describe(other)}` : ''}`;
    return { answered: true, launcher, text };
  } catch {
    return { answered: false, launcher: null, text: `TV not answering (this Mac is ${macOnTvNetwork() ? 'on' : 'off'} its network)` };
  }
}

const stamp = () => (long ? new Date().toLocaleString('sv-SE') : new Date().toTimeString().slice(0, 8));
function say(line) {
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, `${line}\n`);
}

let last = '';
let stopped = 0;
let lastRunning = null;
while (Date.now() - start < lengthMs) {
  const now = await reading();
  if (long) say(`${stamp()} ${now.text}`);
  else if (now.text !== last) say(`${stamp()} +${((Date.now() - start) / 1000).toFixed(1)}s ${now.text}`);
  last = now.text;

  if (long && now.answered) {
    if (now.launcher === 'not running') stopped++;
    else {
      stopped = 0;
      lastRunning = stamp();
    }
    if (stopped >= STOPPED_AFTER) {
      say(`${stamp()} the launcher has stopped. Last seen running: ${lastRunning ?? 'never in this watch'}`);
      process.exit(2);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, everyMs));
}
if (long) say(`${stamp()} watch over after ${hours} h. Last reading: ${last}`);
