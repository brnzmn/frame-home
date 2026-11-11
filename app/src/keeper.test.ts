// @ts-nocheck: this test runs in Node and the project carries no Node type definitions.
// The keeper service (app/public/service/keeper.js) run against a fake TV: the TV's status
// pages and its art channel, as recorded from the real one on 2026-11-11.
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const KEEPER = require.resolve('../public/service/keeper.js');
const LAUNCHER = 'FrameHome1.FrameHome';

interface FakeTv {
  port: number;
  power: string;
  launcher: { running: boolean; visible: boolean };
  /** In TV mode the real art service does not answer at all. */
  artAnswers: 'on' | 'off' | null;
  /** Something the TV says by itself on the art channel. */
  say(event: Record<string, unknown>): void;
  asked: number;
  close(): Promise<void>;
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

async function startFakeTv(): Promise<FakeTv> {
  const sockets = new Set<Duplex>();
  const tv: FakeTv = {
    port: 0,
    power: 'on',
    launcher: { running: false, visible: false },
    artAnswers: 'on',
    asked: 0,
    say(event) {
      for (const s of sockets) s.write(frame(JSON.stringify({ event: 'd2d_service_message', data: JSON.stringify(event) })));
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v2/') res.end(JSON.stringify({ device: { PowerState: tv.power, FrameTVSupport: 'true' } }));
    else if (req.url === `/api/v2/applications/${LAUNCHER}`) res.end(JSON.stringify({ id: LAUNCHER, ...tv.launcher }));
    else res.writeHead(404).end(JSON.stringify({ code: 404 }));
  });

  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    socket.write(frame(JSON.stringify({ event: 'ms.channel.connect', data: { clients: [] } })));

    let pending = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (pending.length < 6) return;
        let length = pending[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          length = pending.readUInt16BE(2);
          offset = 4;
        }
        if (pending.length < offset + 4 + length) return;
        const mask = pending.subarray(offset, offset + 4);
        const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        pending = pending.subarray(offset + 4 + length);
        const message = JSON.parse(payload.toString('utf8'));
        const request = JSON.parse(message.params.data);
        if (request.request === 'get_artmode_status') {
          tv.asked++;
          if (tv.artAnswers) tv.say({ event: 'get_artmode_status', request_id: request.request_id, value: tv.artAnswers });
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  tv.port = (server.address() as AddressInfo).port;
  return tv;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough for the service to have acted on what it was told. */
const SETTLED = 600;
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(20);
}

let tv: FakeTv | undefined;
let keeper: { onStart(): void; onStop(): void } | undefined;
let opened: string[] = [];
let statusPort = 0;

async function startKeeper(art: FakeTv['artAnswers'] = 'on'): Promise<void> {
  tv = await startFakeTv();
  tv.artAnswers = art;
  opened = [];
  statusPort = tv.port + 1 > 65000 ? tv.port - 1 : tv.port + 1;
  process.env.FRAME_HOME_TV_PORT = String(tv.port);
  process.env.FRAME_HOME_STATUS_PORT = String(statusPort);
  // The real service asks every five seconds; the tests would crawl.
  process.env.FRAME_HOME_ART_ASK_MS = '150';
  (globalThis as any).tizen = {
    application: {
      launch: (id: string, ok: () => void) => {
        opened.push(id);
        ok();
      },
    },
  };
  delete require.cache[KEEPER];
  keeper = require(KEEPER);
  keeper!.onStart();
  await until(() => tv!.asked > 1);
}

async function afterEachCleanup(): Promise<void> {
  keeper?.onStop();
  await tv?.close();
  keeper = undefined;
  tv = undefined;
}
afterEach(afterEachCleanup);

async function status(): Promise<any> {
  return (await fetch(`http://127.0.0.1:${statusPort}/`)).json();
}

describe('the keeper service', () => {
  it('follows Art Mode from what the TV answers and announces', async () => {
    await startKeeper();
    expect((await status()).state.art).toBe('on');
    tv!.artAnswers = 'off';
    tv!.say({ event: 'art_mode_changed', status: 'off' });
    await wait(100);
    expect((await status()).state.art).toBe('off');
  });

  it('calls the art service silent, not off, when it stops answering', async () => {
    await startKeeper();
    tv!.artAnswers = null;
    await wait(SETTLED);
    expect((await status()).state.art).toBe('silent');
  });

  it('never opens the launcher, whatever happens to Art Mode', async () => {
    await startKeeper();
    tv!.say({ event: 'art_mode_changed', status: 'off' });
    await wait(SETTLED);
    tv!.say({ event: 'art_mode_changed', status: 'on' });
    tv!.artAnswers = null;
    await wait(SETTLED);
    tv!.say({ event: 'go_to_standby' });
    await wait(SETTLED);
    expect(opened).toEqual([]);
  });

  it('tells the launcher how long ago the TV said it was going to sleep', async () => {
    await startKeeper();
    const before = await (await fetch(`http://127.0.0.1:${statusPort}/sleep`)).json();
    expect(before.sleepNoticeAgeMs).toBeNull();
    tv!.say({ event: 'go_to_standby' });
    await wait(100);
    const after = await (await fetch(`http://127.0.0.1:${statusPort}/sleep`)).json();
    expect(after.sleepNoticeAgeMs).toBeLessThan(1000);
  });

  it('keeps the launcher\'s record lines with its own', async () => {
    await startKeeper();
    await fetch(`http://127.0.0.1:${statusPort}/note?text=${encodeURIComponent('hidden, in front: org.tizen.art-app')}`);
    const { log } = await status();
    expect(log[log.length - 1]).toContain('launcher: hidden, in front: org.tizen.art-app');
  });

  it('says what it is doing on its own status page', async () => {
    await startKeeper();
    const page = await status();
    expect(page.service).toBe('frame-home-keeper');
    expect(page.state.artConnected).toBe(true);
    expect(page.log[0]).toContain('keeper started');
  });
});
