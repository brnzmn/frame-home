#!/usr/bin/env node
// How fast the launcher answers the remote, measured on the TV through its debug port
// (open it with `node tools/deploy.mjs build/app --debug`).
//
//   node tools/lag-test.mjs [--presses 40] [--gap 700] [--css "<css to add first>"] [--label text]
//
// Presses arrow keys in a fixed pattern (along the app row, and between rows), one every --gap
// ms, then reads the launcher's own record (`window.__frameHomeLag`, app/src/ui/home.ts) and
// prints the median and the 95th percentile. --css adds a style to the page first, to measure
// the launcher without one suspect (for example ".wash{display:none}").
const PORT = Number(process.env.CDP_PORT ?? 9222);
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const presses = Number(flag('--presses', 40));
const gap = Number(flag('--gap', 700));
const css = flag('--css', '');
const label = flag('--label', css ? `with ${css}` : 'as built');
const KEYS = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
const PATTERN = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!page) throw new Error('no debuggable page on the TV');
  const url = new URL(page.webSocketDebuggerUrl);
  url.hostname = '127.0.0.1';
  url.port = String(PORT);
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('debug socket refused')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => ws.close() };
}

const evaluate = async (cdp, expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

const cdp = await connect();
if (css) await evaluate(cdp, `(document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(`<style data-lag-test>${css}</style>`)}), true)`);
await evaluate(cdp, 'window.__frameHomeLag && (window.__frameHomeLag.length = 0), true');
for (let i = 0; i < presses; i++) {
  const code = KEYS[PATTERN[i % PATTERN.length]];
  const base = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: PATTERN[i % PATTERN.length] };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(gap);
}
await sleep(800);
const samples = (await evaluate(cdp, 'window.__frameHomeLag || []')) ?? [];
const start = await evaluate(cdp, 'window.__frameHomeStart || null');
if (css) await evaluate(cdp, "document.querySelectorAll('style[data-lag-test]').forEach((s) => s.remove()), true");
cdp.close();

if (!samples.length) {
  console.log(`${label}: no samples (is this a build with the lag record?)`);
  process.exit(1);
}
const line = (key) => `${key} median ${quantile(samples.map((s) => s[key]), 0.5)}, p95 ${quantile(samples.map((s) => s[key]), 0.95)}`;
console.log(`${label}: ${samples.length} presses`);
console.log(`  key to screen (ms): ${line('frame')}`);
console.log(`  waiting for our handler (ms): ${line('queue')}; handler itself (ms): ${line('handler')}`);
console.log(`  animation after a press: fps ${line('fps')}; worst frame gap (ms) ${line('worstGap')}`);
if (start) console.log(`  start (ms from page start): ${JSON.stringify(start)}`);
