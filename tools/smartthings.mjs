#!/usr/bin/env node
// The TV through Samsung's SmartThings cloud: what it reports there, and the rule that opens
// Frame Home when the TV is switched on.
//
//   node tools/smartthings.mjs devices          every device on the account; remembers the TV
//   node tools/smartthings.mjs status           what the TV reports right now
//   node tools/smartthings.mjs watch [seconds]  print every change in what it reports (default 120)
//   node tools/smartthings.mjs launch           ask the TV once to open Frame Home
//   node tools/smartthings.mjs rule             show the rule that would be created
//   node tools/smartthings.mjs rule --create    create it (replaces an earlier one of ours)
//   node tools/smartthings.mjs rule --list      our rules as SmartThings has them
//   node tools/smartthings.mjs rule --delete    remove ours
//
// The token is read from the keychain each time (`secret.sh get smartthings/frame-home`) and is
// never printed. The TV's ids on the account are kept in .tv.json, which is not committed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tvFile = path.join(root, '.tv.json');
const API = 'https://api.smartthings.com/v1';
const APP_ID = 'FrameHome1.FrameHome';
const RULE_NAME = 'Frame Home at power-on';
const args = process.argv.slice(2);
const command = args[0];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function token() {
  try {
    const value = execFileSync(path.join(os.homedir(), 'agent-core/bin/secret.sh'), ['get', 'smartthings/frame-home'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (value) return value;
  } catch {
    // fall through
  }
  fail('No SmartThings token in the keychain. Baran stores one with: ~/agent-core/bin/secret.sh set smartthings/frame-home');
}

let bearer;
async function api(method, route, body) {
  bearer ??= token();
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const hint = response.status === 401 ? ' (the token is wrong or has expired; they last 24 hours)' : response.status === 403 ? ' (the token lacks a permission)' : '';
    const error = new Error(`SmartThings answered ${response.status}${hint} for ${method} ${route.split('?')[0]}: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const short = (id) => (typeof id === 'string' && id.length > 8 ? `${id.slice(0, 8)}…` : id);
const readTv = () => (fs.existsSync(tvFile) ? JSON.parse(fs.readFileSync(tvFile, 'utf8')) : {});

function remembered() {
  const saved = readTv().smartthings;
  if (!saved?.deviceId || !saved?.locationId) fail('The TV is not known yet. Run: node tools/smartthings.mjs devices');
  return saved;
}

const capabilitiesOf = (device) => (device.components ?? []).flatMap((c) => (c.capabilities ?? []).map((cap) => cap.id));

async function devices() {
  const list = (await api('GET', '/devices')).items ?? [];
  if (!list.length) fail('SmartThings lists no devices for this account. Is the TV added in the SmartThings phone app?');
  const tvs = [];
  for (const device of list) {
    const caps = capabilitiesOf(device);
    const looksLikeTv = /tv/i.test(`${device.deviceTypeName ?? ''} ${device.ocf?.ocfDeviceType ?? ''}`) || caps.includes('custom.launchapp');
    if (looksLikeTv) tvs.push(device);
    console.log(`${looksLikeTv ? 'TV ' : '   '} ${device.label ?? device.name}  [${device.deviceTypeName ?? device.type ?? '?'}]  id ${short(device.deviceId)}  ${caps.length} capabilities`);
  }
  if (tvs.length !== 1) {
    console.log(tvs.length ? `\n${tvs.length} TVs found; not remembering any. Pass the one to use: devices --use <start of its id>` : '\nNo TV among them.');
    const wanted = args[args.indexOf('--use') + 1];
    const chosen = args.includes('--use') ? list.find((d) => d.deviceId.startsWith(wanted)) : null;
    if (!chosen) return;
    tvs.splice(0, tvs.length, chosen);
  }
  const tv = tvs[0];
  const saved = readTv();
  saved.smartthings = { deviceId: tv.deviceId, locationId: tv.locationId };
  fs.writeFileSync(tvFile, `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`\nremembered "${tv.label ?? tv.name}" in .tv.json`);
  console.log(`can open apps (custom.launchapp): ${capabilitiesOf(tv).includes('custom.launchapp') ? 'yes' : 'NO'}`);
  console.log(`capabilities: ${capabilitiesOf(tv).join(', ')}`);
}

/** The TV's whole status as "capability.attribute" -> short text. */
async function flatStatus(deviceId) {
  const data = await api('GET', `/devices/${deviceId}/status`);
  const flat = new Map();
  for (const [component, capabilities] of Object.entries(data.components ?? {})) {
    for (const [capability, attributes] of Object.entries(capabilities ?? {})) {
      for (const [attribute, entry] of Object.entries(attributes ?? {})) {
        const value = entry?.value;
        const text = value === null || value === undefined ? 'null' : typeof value === 'string' ? value : JSON.stringify(value);
        flat.set(`${component === 'main' ? '' : `${component}:`}${capability}.${attribute}`, text.length > 110 ? `${text.slice(0, 110)}…` : text);
      }
    }
  }
  return flat;
}

// Values that would identify the TV or the account; shown as present, not printed.
const PRIVATE = /(mac|serial|uuid|token|\.di$|\.pi$|duid|deviceid|mnid|vid$|ip$|ssid|email|account)/i;
const shown = (key, value) => (PRIVATE.test(key) && value !== 'null' ? '(set)' : value);

async function status() {
  const { deviceId } = remembered();
  const [flat, health] = await Promise.all([flatStatus(deviceId), api('GET', `/devices/${deviceId}/health`).catch(() => null)]);
  console.log(`reachable through SmartThings: ${health?.state ?? 'unknown'}`);
  for (const [key, value] of [...flat].sort()) console.log(`${key} = ${shown(key, value)}`);
}

async function watch() {
  const { deviceId } = remembered();
  const seconds = Number(args[1] ?? 120);
  const start = Date.now();
  let last = null;
  let lastHealth = null;
  const clock = () => new Date().toTimeString().slice(0, 8);
  while (Date.now() - start < seconds * 1000) {
    try {
      const [flat, health] = await Promise.all([flatStatus(deviceId), api('GET', `/devices/${deviceId}/health`).catch(() => null)]);
      if (health?.state !== lastHealth) {
        console.log(`${clock()} reachable: ${health?.state ?? 'unknown'}`);
        lastHealth = health?.state;
      }
      if (last) {
        for (const [key, value] of flat) if (last.get(key) !== value) console.log(`${clock()} ${key}: ${shown(key, last.get(key) ?? '(none)')} -> ${shown(key, value)}`);
      } else {
        console.log(`${clock()} watching ${flat.size} values; switch = ${flat.get('switch.switch')}`);
      }
      last = flat;
    } catch (error) {
      console.log(`${clock()} ${error.message}`);
      if (error.status === 401) process.exit(1);
      if (error.status === 429) await new Promise((r) => setTimeout(r, 10000));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function launch() {
  const { deviceId } = remembered();
  const started = Date.now();
  const result = await api('POST', `/devices/${deviceId}/commands`, {
    commands: [{ component: 'main', capability: 'custom.launchapp', command: 'launchApp', arguments: [APP_ID] }],
  });
  console.log(`asked the TV to open ${APP_ID}: ${JSON.stringify(result?.results ?? result)} (${Date.now() - started} ms)`);
}

/**
 * The rule. It acts once each time the TV's switch goes to "on", and asks for the launcher
 * `attempts` times, `gap` seconds apart, because the TV drops requests while it is still
 * coming out of Art Mode. Values come from the tests in docs/phase0-findings.md.
 */
function ruleBody(deviceId, { firstDelay, attempts, gap }) {
  const open = { command: { devices: [deviceId], commands: [{ component: 'main', capability: 'custom.launchapp', command: 'launchApp', arguments: [{ string: APP_ID }] }] } };
  const wait = (value) => ({ sleep: { duration: { value: { integer: value }, unit: 'Second' } } });
  const then = [];
  if (firstDelay > 0) then.push(wait(firstDelay));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) then.push(wait(gap));
    then.push(open);
  }
  return {
    name: RULE_NAME,
    actions: [
      {
        if: {
          changes: {
            equals: {
              left: { device: { devices: [deviceId], component: 'main', capability: 'switch', attribute: 'switch' } },
              right: { string: 'on' },
            },
          },
          then,
        },
      },
    ],
  };
}

const numberFlag = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);

async function rule() {
  const { deviceId, locationId } = remembered();
  const query = `?locationId=${locationId}`;
  const ours = async () => ((await api('GET', `/rules${query}`)).items ?? []).filter((r) => r.name === RULE_NAME);

  if (args.includes('--list')) {
    const all = (await api('GET', `/rules${query}`)).items ?? [];
    console.log(`${all.length} rule(s) at this location; ${all.filter((r) => r.name === RULE_NAME).length} of them ours`);
    for (const r of all.filter((x) => x.name === RULE_NAME)) console.log(`"${r.name}" id ${short(r.id)} status ${r.status ?? '?'}\n${JSON.stringify(r.actions).replaceAll(deviceId, '<the TV>')}`);
    return;
  }
  if (args.includes('--delete') || args.includes('--create')) {
    for (const r of await ours()) {
      await api('DELETE', `/rules/${r.id}${query}`);
      console.log(`removed our rule ${short(r.id)}`);
    }
    if (args.includes('--delete')) return;
  }
  const body = ruleBody(deviceId, { firstDelay: numberFlag('--first-delay', 0), attempts: numberFlag('--attempts', 1), gap: numberFlag('--gap', 4) });
  if (!args.includes('--create')) {
    console.log(JSON.stringify(body, null, 2).replaceAll(deviceId, '<the TV>'));
    console.log('\ndry run; add --create to create it');
    return;
  }
  const created = await api('POST', `/rules${query}`, body);
  console.log(`created "${created.name}" id ${short(created.id)} status ${created.status ?? '?'}`);
}

const commands = { devices, status, watch, launch, rule };
if (!commands[command]) fail('usage: node tools/smartthings.mjs devices | status | watch [seconds] | launch | rule [--create | --list | --delete] [--first-delay S] [--attempts N] [--gap S]');
try {
  await commands[command]();
} catch (error) {
  fail(error.message);
}
