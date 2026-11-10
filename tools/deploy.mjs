#!/usr/bin/env node
// Packages an app folder, signs it with the Samsung certificate profile, installs it on the
// TV and opens it.
//
//   node tools/deploy.mjs probe                    package, sign, install, open
//   node tools/deploy.mjs probe --debug            also open the TV's debug port on localhost:9222
//   node tools/deploy.mjs probe --profile NAME     certificate profile (default: framehome)
//
// Needs .tv.json (node tools/find-tv.mjs) and a certificate profile that contains the TV's DUID.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIZEN = path.join(os.homedir(), 'tizen-studio/tools/ide/bin/tizen');
const SDB = path.join(os.homedir(), 'tizen-studio/tools/sdb');

const args = process.argv.slice(2);
const appDirName = args.find((a) => !a.startsWith('--'));
const debug = args.includes('--debug');
const profileFlag = args.indexOf('--profile');
const profile = profileFlag >= 0 ? args[profileFlag + 1] : 'framehome';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(bin, binArgs, { quiet = false } = {}) {
  const out = execFileSync(bin, binArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!quiet) process.stdout.write(out);
  return out;
}

// This Mac's address on the TV's own network. The house has more than one network, and the
// TV can only reach the address that shares its subnet.
function macLanIp(tvIp) {
  const prefix = tvIp.split('.').slice(0, 3).join('.') + '.';
  let first = null;
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/^(en|eth|wl)/.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith(prefix)) return a.address;
      first ??= a.address;
    }
  }
  return first;
}

if (!appDirName) fail('usage: node tools/deploy.mjs <app folder> [--debug] [--profile NAME]');
const appDir = path.join(root, appDirName);
const configFile = path.join(appDir, 'config.xml');
if (!fs.existsSync(configFile)) fail(`${appDirName}/config.xml not found`);
if (!fs.existsSync(path.join(root, '.tv.json'))) fail('No .tv.json yet. Turn the TV on and run: node tools/find-tv.mjs');

const config = fs.readFileSync(configFile, 'utf8');
const appId = /<tizen:application[^>]*\sid="([^"]+)"/.exec(config)?.[1];
const appName = /<name>([^<]+)<\/name>/.exec(config)?.[1];
if (!appId || !appName) fail('config.xml needs <tizen:application id="…"> and <name>');
const tv = JSON.parse(fs.readFileSync(path.join(root, '.tv.json'), 'utf8'));
const target = `${tv.ip}:26101`;

// The probe posts its report to this Mac; write where that is right now.
if (appDirName === 'probe') {
  const ip = macLanIp(tv.ip);
  if (!ip) fail('this Mac has no local network address');
  fs.writeFileSync(path.join(appDir, 'probe-config.js'), `window.PROBE_CONFIG = { server: 'http://${ip}:8787' };\n`);
}

// Stage a clean copy so nothing local (dotfiles, old packages) ends up on the TV.
const stage = path.join(root, 'dist', appDirName);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const entry of fs.readdirSync(appDir)) {
  if (entry.startsWith('.') || entry.endsWith('.wgt')) continue;
  fs.cpSync(path.join(appDir, entry), path.join(stage, entry), { recursive: true });
}

console.log(`connecting to ${target}`);
run(SDB, ['connect', target]);
const devices = run(SDB, ['devices'], { quiet: true });
if (!devices.includes(target)) fail(`the TV did not accept the developer connection:\n${devices}`);

console.log(`packaging ${appName} with certificate profile "${profile}"`);
run(TIZEN, ['package', '-t', 'wgt', '-s', profile, '--', stage]);
const packaged = fs.readdirSync(stage).find((f) => f.endsWith('.wgt'));
if (!packaged) fail('packaging produced no .wgt file');
// The TV's installer fails on a file name with a space ("Failed to install Tizen application",
// empty log), and the packager names the file after the app, so rename it first.
const wgt = `${appId.split('.').pop()}.wgt`;
if (packaged !== wgt) fs.renameSync(path.join(stage, packaged), path.join(stage, wgt));

console.log(`installing ${wgt}`);
run(TIZEN, ['install', '-n', wgt, '-s', target, '--', stage]);

if (debug) {
  const out = run(SDB, ['-s', target, 'shell', '0', 'debug', appId], { quiet: true });
  const port = /port:\s*(\d+)/.exec(out)?.[1];
  if (!port) fail(`the TV did not report a debug port:\n${out}`);
  run(SDB, ['-s', target, 'forward', 'tcp:9222', `tcp:${port}`]);
  console.log(`opened ${appId} in debug mode; debug port forwarded to localhost:9222`);
} else {
  run(TIZEN, ['run', '-p', appId, '-s', target]);
  console.log(`opened ${appId}`);
}
