#!/usr/bin/env node
// Finds the Samsung TV on this Mac's local network by asking every address for the
// TV's public info page (port 8001). Prints one JSON line per TV and writes .tv.json
// (gitignored). MAC addresses and device ids are never printed or stored.
//
//   node tools/find-tv.mjs                 one scan
//   node tools/find-tv.mjs --wait          keep scanning until a TV answers
//   node tools/find-tv.mjs --need-dev      only accept a TV whose Developer Mode points at this Mac
//   node tools/find-tv.mjs --interval 15   seconds between scans with --wait
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const wait = args.includes('--wait');
const needDev = args.includes('--need-dev');
const intervalMs = Number(argValue('--interval') ?? 15) * 1000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function localSubnets() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/^(en|eth|wl)/.test(name)) continue; // skip VPN tunnels and loopback
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const p = a.address.split('.');
      out.push({ self: a.address, base: `${p[0]}.${p[1]}.${p[2]}.` });
    }
  }
  return out;
}

function portOpen(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

async function tvInfo(host) {
  try {
    const r = await fetch(`http://${host}:8001/api/v2/`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    const d = j.device ?? {};
    if (!d.modelName && !/samsung/i.test(String(j.name ?? ''))) return null;
    return {
      ip: host,
      name: d.name,
      modelName: d.modelName,
      model: d.model,
      os: d.OS,
      powerState: d.PowerState,
      frame: d.FrameTVSupport,
      developerMode: d.developerMode,
      developerIP: d.developerIP,
      resolution: d.resolution,
    };
  } catch {
    return null;
  }
}

async function scanOnce() {
  const found = [];
  for (const { self, base } of localSubnets()) {
    const hosts = Array.from({ length: 254 }, (_, i) => base + (i + 1)).filter((h) => h !== self);
    const open = (await Promise.all(hosts.map(async (h) => ((await portOpen(h, 8001)) ? h : null)))).filter(Boolean);
    for (const h of open) {
      const info = await tvInfo(h);
      if (info) found.push({ ...info, macIp: self });
    }
  }
  return found;
}

for (;;) {
  const tvs = await scanOnce();
  const ready = tvs.filter((t) => !needDev || (t.developerMode === '1' && t.developerIP === t.macIp));
  if (ready.length) {
    for (const t of ready) console.log(JSON.stringify(t));
    fs.writeFileSync(path.join(root, '.tv.json'), JSON.stringify(ready[0], null, 2) + '\n');
    process.exit(0);
  }
  if (!wait) {
    if (tvs.length) {
      console.log(`TV found, Developer Mode not pointing at this Mac yet: ${JSON.stringify(tvs)}`);
      process.exit(2);
    }
    console.log('no Samsung TV answered on this network');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
