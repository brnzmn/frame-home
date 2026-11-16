#!/usr/bin/env node
// The TV through Samsung's SmartThings cloud: what it reports there, and the rule that opens
// Frame Home when the TV is switched on.
//
//   node tools/smartthings.mjs devices          every device on the account; remembers the TV
//   node tools/smartthings.mjs status           what the TV reports right now
//   node tools/smartthings.mjs watch [seconds]  print every change in what it reports (default 120)
//   node tools/smartthings.mjs watch --hours 10 [--every 30] [--log FILE]   the same over a night
//   node tools/smartthings.mjs launch           ask the TV once to open Frame Home
//   node tools/smartthings.mjs rule             show the two rules that would be created
//   node tools/smartthings.mjs rule --create    create them (replaces earlier ones of ours)
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
const POLL_NAME = 'Frame Home: ask the TV every minute';
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
  let response;
  try {
    response = await fetch(`${API}${route}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`SmartThings could not be reached (${error.cause?.code ?? error.name}: ${error.message})`);
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const hint = response.status === 401 ? ' (the token is wrong or has expired; they last 24 hours)' : response.status === 403 ? ' (the token lacks a permission)' : '';
    const error = new Error(`SmartThings answered ${response.status}${hint} for ${method} ${hideIds(route.split('?')[0])}: ${hideIds(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// Device, location and request ids in error text are shortened, so logs and chat never carry them whole.
const hideIds = (text) => text.replace(/\b([0-9a-f]{8})(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '$1…').replace(/("requestId":")[0-9a-f]+/g, '$1…');
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
  // --use always wins, in case the TV is listed under a type this does not recognise.
  const wanted = args.includes('--use') ? args[args.indexOf('--use') + 1] : null;
  const tv = wanted ? list.find((d) => d.deviceId.startsWith(wanted)) : tvs.length === 1 ? tvs[0] : null;
  if (!tv) {
    if (wanted) console.log(`\nNo device id starts with "${wanted}".`);
    else if (tvs.length) console.log(`\n${tvs.length} TVs found; not remembering any. Pass the one to use: devices --use <start of its id>`);
    else console.log('\nNo TV among them. If it is listed under another type: devices --use <start of its id>');
    return;
  }
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
  const hours = numberFlag('--hours', 0);
  const long = hours > 0;
  // Each look is two requests and new tokens have low request limits, so a long watch looks rarely.
  const everyMs = numberFlag('--every', long ? 30 : 2) * 1000;
  const lengthMs = long ? hours * 3600_000 : Number(/^\d+$/.test(args[1] ?? '') ? args[1] : 120) * 1000;
  const logFile = args.includes('--log') ? args[args.indexOf('--log') + 1] : null;
  const stamp = () => (long ? new Date().toLocaleString('sv-SE') : new Date().toTimeString().slice(0, 8));
  const say = (text) => {
    const line = `${stamp()} ${text}`;
    console.log(line);
    if (logFile) fs.appendFileSync(logFile, `${line}\n`);
  };
  const start = Date.now();
  let last = null;
  let lastHealth = null;
  let lastError = null;
  while (Date.now() - start < lengthMs) {
    try {
      const [flat, health] = await Promise.all([flatStatus(deviceId), api('GET', `/devices/${deviceId}/health`).catch(() => null)]);
      if (lastError) say('SmartThings answers again');
      lastError = null;
      if (health?.state !== lastHealth) {
        say(`reachable: ${health?.state ?? 'unknown'}`);
        lastHealth = health?.state;
      }
      if (last) {
        for (const [key, value] of flat) if (last.get(key) !== value) say(`${key}: ${shown(key, last.get(key) ?? '(none)')} -> ${shown(key, value)}`);
      } else {
        say(`watching ${flat.size} values every ${everyMs / 1000} s; switch = ${flat.get('switch.switch')}`);
      }
      last = flat;
    } catch (error) {
      // The same failure is said once, not at every look.
      if (error.message !== lastError) say(error.message);
      lastError = error.message;
      if (error.status === 401) process.exit(1);
      if (error.status === 429) await new Promise((r) => setTimeout(r, 60000));
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  if (long) say(`watch over after ${hours} h; switch = ${last?.get('switch.switch') ?? 'unknown'}`);
}

async function launch() {
  const { deviceId } = remembered();
  const started = Date.now();
  const result = await api('POST', `/devices/${deviceId}/commands`, {
    commands: [{ component: 'main', capability: 'custom.launchapp', command: 'launchApp', arguments: [APP_ID] }],
  });
  console.log(`asked the TV to open ${APP_ID}: ${JSON.stringify(result?.results ?? result)} (${Date.now() - started} ms)`);
}

// Measured 2026-11-16: the TV's switch reads "on" in Art Mode, asleep and in TV mode alike, and
// the TV tells SmartThings what is in front (tvChannel.tvChannelName) only when asked to refresh.
// So power-on is seen with two rules: one asks the TV every minute, the other opens Frame Home
// when Samsung's start screen comes to the front. Up to about a minute late, by design.
const START_SCREENS = ['com.samsung.tv.csfs', 'HEPsqFNie0.tvplusstandalone']; // Samsung's home, Samsung TV Plus

function pollBody(deviceId, minutes) {
  const refresh = { command: { devices: [deviceId], commands: [{ component: 'main', capability: 'refresh', command: 'refresh' }] } };
  return { name: POLL_NAME, actions: [{ every: { interval: { value: { integer: minutes }, unit: 'Minute' }, actions: [refresh] } }] };
}

/**
 * Opens the launcher each time one of Samsung's start screens becomes the app in front. It asks
 * `attempts` times, `gap` seconds apart, because the TV drops requests while it is still coming
 * out of Art Mode.
 */
function openBody(deviceId, { startScreens, firstDelay, attempts, gap }) {
  const open = { command: { devices: [deviceId], commands: [{ component: 'main', capability: 'custom.launchapp', command: 'launchApp', arguments: [{ string: APP_ID }] }] } };
  const wait = (value) => ({ sleep: { duration: { value: { integer: value }, unit: 'Second' } } });
  const then = [];
  if (firstDelay > 0) then.push(wait(firstDelay));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) then.push(wait(gap));
    then.push(open);
  }
  const front = { device: { devices: [deviceId], component: 'main', capability: 'tvChannel', attribute: 'tvChannelName' } };
  return { name: RULE_NAME, actions: startScreens.map((screen) => ({ if: { changes: { equals: { left: front, right: { string: screen } } }, then } })) };
}

const numberFlag = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const OUR_RULES = () => [RULE_NAME, POLL_NAME];

async function rule() {
  const { deviceId, locationId } = remembered();
  const query = `?locationId=${locationId}`;
  const ours = async () => ((await api('GET', `/rules${query}`)).items ?? []).filter((r) => OUR_RULES().includes(r.name));

  if (args.includes('--list')) {
    const all = (await api('GET', `/rules${query}`)).items ?? [];
    const mine = all.filter((r) => OUR_RULES().includes(r.name));
    console.log(`${all.length} rule(s) at this location; ${mine.length} of them ours`);
    for (const r of mine) console.log(`"${r.name}" id ${short(r.id)} status ${r.status ?? '?'}\n${JSON.stringify(r.actions).replaceAll(deviceId, '<the TV>')}`);
    return;
  }
  if (args.includes('--delete') || args.includes('--create')) {
    for (const r of await ours()) {
      await api('DELETE', `/rules/${r.id}${query}`);
      console.log(`removed our rule "${r.name}" ${short(r.id)}`);
    }
    if (args.includes('--delete')) return;
  }
  const screens = args.includes('--start-screens') ? args[args.indexOf('--start-screens') + 1].split(',') : START_SCREENS;
  const bodies = [
    pollBody(deviceId, numberFlag('--every', 1)),
    openBody(deviceId, { startScreens: screens, firstDelay: numberFlag('--first-delay', 0), attempts: numberFlag('--attempts', 1), gap: numberFlag('--gap', 4) }),
  ];
  if (!args.includes('--create')) {
    for (const body of bodies) console.log(JSON.stringify(body, null, 2).replaceAll(deviceId, '<the TV>'));
    console.log('\ndry run; add --create to create them');
    return;
  }
  for (const body of bodies) {
    const created = await api('POST', `/rules${query}`, body);
    console.log(`created "${created.name}" id ${short(created.id)} status ${created.status ?? '?'}`);
  }
}

const commands = { devices, status, watch, launch, rule };
if (!commands[command]) fail('usage: node tools/smartthings.mjs devices | status | watch [seconds | --hours N [--every S] [--log FILE]] | launch | rule [--create | --list | --delete] [--every MIN] [--start-screens a,b] [--first-delay S] [--attempts N] [--gap S]');
try {
  await commands[command]();
} catch (error) {
  fail(error.message);
}
