#!/usr/bin/env node
// Talks to the app running on the TV through its debug port (Chrome DevTools Protocol).
// Open the port first, see docs/RUNBOOK.md:
//   sdb -s <tv>:26101 shell 0 debug <appId>      prints "... port: N"
//   sdb -s <tv>:26101 forward tcp:9222 tcp:N
//
//   node tools/tv-inspect.mjs eval "<js expression>"   print the JSON result
//   node tools/tv-inspect.mjs shot out.png             screenshot of the app
//   node tools/tv-inspect.mjs key ArrowDown [Enter …]  send remote keys
//   node tools/tv-inspect.mjs console [seconds]        stream console output
// The TV serves one debug client at a time.
import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const [cmd, ...rest] = process.argv.slice(2);

const KEYS = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  Back: 10009,
  0: 48, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, 8: 56, 9: 57,
};

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
  const listeners = [];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, on: (l) => listeners.push(l), close: () => ws.close(), title: page.title, pageUrl: page.url };
}

async function main() {
  if (!cmd) {
    console.log('usage: tv-inspect.mjs eval <expr> | shot <file.png> | key <name…> | console [seconds]');
    process.exit(1);
  }
  const cdp = await connect();
  try {
    if (cmd === 'eval') {
      const r = await cdp.send('Runtime.evaluate', { expression: rest.join(' '), returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      console.log(JSON.stringify(r.result.value, null, 2));
    } else if (cmd === 'shot') {
      const file = rest[0] ?? 'tv.png';
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log(`saved ${file}`);
    } else if (cmd === 'key') {
      for (const name of rest) {
        const code = KEYS[name];
        if (code === undefined) throw new Error(`unknown key ${name}`);
        const base = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name };
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        await new Promise((r) => setTimeout(r, 250));
      }
      console.log(`sent ${rest.join(' ')}`);
    } else if (cmd === 'console') {
      const seconds = Number(rest[0] ?? 20);
      cdp.on((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled') {
          console.log(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
          console.log(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
        }
      });
      await cdp.send('Runtime.enable');
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } else {
      throw new Error(`unknown command ${cmd}`);
    }
  } finally {
    cdp.close();
  }
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
