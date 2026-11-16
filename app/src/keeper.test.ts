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
  /** Every art request name the TV was sent, in order. */
  requests: string[];
  /** What the TV answers, by request name, on top of get_artmode_status; unlisted requests get no answer. */
  replies: Record<string, Record<string, unknown>>;
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
    requests: [],
    replies: {},
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
        tv.requests.push(request.request);
        if (tv.replies[request.request]) tv.say({ event: request.request, request_id: request.request_id, ...tv.replies[request.request] });
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

async function startKeeper(art: FakeTv['artAnswers'] = 'on', use?: 'off' | 'listen'): Promise<void> {
  tv = await startFakeTv();
  tv.artAnswers = art;
  opened = [];
  statusPort = tv.port + 1 > 65000 ? tv.port - 1 : tv.port + 1;
  process.env.FRAME_HOME_TV_PORT = String(tv.port);
  process.env.FRAME_HOME_STATUS_PORT = String(statusPort);
  // The real service asks every five seconds; the tests would crawl.
  process.env.FRAME_HOME_ART_ASK_MS = '150';
  process.env.FRAME_HOME_ART_PROBE_MS = '150';
  if (use) process.env.FRAME_HOME_ART_USE = use;
  else delete process.env.FRAME_HOME_ART_USE;
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
  if (use !== 'off') await until(() => tv!.asked > 1);
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

  describe('GET /art-probe', () => {
    const probe = async (): Promise<any> => (await fetch(`http://127.0.0.1:${statusPort}/art-probe`)).json();
    const byName = (page: any, name: string) => page.results.find((r: any) => r.request === name);

    it('reports which reads got an answer and which did not', async () => {
      await startKeeper();
      tv!.replies = {
        get_brightness: { value: '5' },
        get_matte_list: { matte_type_list: '[{"matte_type":"shadowbox"}]' },
      };
      const page = await probe();
      expect(page.artConnected).toBe(true);
      expect(typeof page.at).toBe('string');
      expect(byName(page, 'get_brightness')).toMatchObject({ answered: true });
      expect(byName(page, 'get_brightness').keys).toEqual(expect.arrayContaining(['event', 'value']));
      expect(byName(page, 'get_brightness').sample).toContain('"value":"5"');
      expect(byName(page, 'get_matte_list').answered).toBe(true);
      expect(byName(page, 'get_matte_list').sample).toContain('shadowbox');
      // The fake answers get_artmode_status too, through its own switch.
      expect(byName(page, 'get_artmode_status').answered).toBe(true);
      for (const name of ['get_device_info', 'get_current_artwork', 'get_slideshow_status', 'get_auto_rotation_status', 'get_color_temperature', 'get_artmode_settings', 'get_photo_filter_list']) {
        expect(byName(page, name)).toMatchObject({ answered: false, keys: [], sample: '' });
      }
      expect(page.results.filter((r: any) => r.request === 'get_content_list').length).toBe(2);
      for (const r of page.results) expect(r.sample.length).toBeLessThanOrEqual(200);
    });

    it('answers nothing in TV mode, and still reports', async () => {
      await startKeeper(null);
      const page = await probe();
      expect(page.results.length).toBeGreaterThan(8);
      expect(page.results.every((r: any) => r.answered === false)).toBe(true);
    });

    it('sends reads only, never anything that changes state', async () => {
      await startKeeper();
      await probe();
      const sent = tv!.requests;
      expect(sent).toContain('get_brightness');
      expect(sent.filter((name) => !name.startsWith('get_'))).toEqual([]);
      expect(sent.filter((name) => /^get_.*(thumbnail|upload|delete|change|select)/.test(name))).toEqual([]);
    });

    it('lists only get_ names in its request constant', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(KEEPER, 'utf8');
      const block = source.slice(source.indexOf('var ART_PROBE_REQUESTS'), source.indexOf('];', source.indexOf('var ART_PROBE_REQUESTS')));
      const names = [...block.matchAll(/request: '([^']+)'/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(8);
      expect(names.filter((n) => !n.startsWith('get_'))).toEqual([]);
    });

    it('strips anything that could identify the TV or the account', async () => {
      await startKeeper();
      tv!.replies = {
        get_current_artwork: {
          content_id: 'MY_F0042',
          category_id: 'MY-C0002',
          device_uuid: '123e4567-e89b-12d3-a456-426614174000',
          serial: 'SN123',
          token: 'secret-token',
          wifi_mac: 'aa:bb:cc:dd:ee:ff',
          note: 'on 192.168.86.20 or aa:bb:cc:dd:ee:ff',
          nested: { duid: 'DUID9', owner_id: 'u1', title: 'Sunrise' },
        },
        get_content_list: { content_list: JSON.stringify([{ content_id: 'SAM-S1111996', matte_id: 'none', other_id: 'MY_not_a_content_key', name: 'Art' }, { content_id: 'user-private-7' }]) },
      };
      const page = await probe();
      const artwork = byName(page, 'get_current_artwork');
      for (const leaked of ['123e4567', 'SN123', 'secret-token', 'aa:bb', 'DUID9', 'u1', '192.168', 'MY-C0002']) expect(artwork.sample).not.toContain(leaked);
      expect(artwork.sample).toContain('MY_F0042');
      expect(artwork.sample).toContain('Sunrise');
      const list = page.results.find((r: any) => r.request === 'get_content_list');
      expect(list.sample).toContain('SAM-S1111996');
      expect(list.sample).toContain('"name":"Art"');
      expect(list.sample).not.toContain('user-private-7');
      expect(list.sample).not.toContain('not_a_content_key');
      expect(list.sample).not.toContain('matte_id');
    });

    it('connects just for the probe when the art channel is switched off, and closes afterwards', async () => {
      await startKeeper('on', 'off');
      expect(tv!.requests).toEqual([]);
      tv!.replies = { get_brightness: { value: '3' } };
      const page = await probe();
      expect(page.artConnected).toBe(true);
      expect(byName(page, 'get_brightness').answered).toBe(true);
      expect(tv!.requests.every((name) => name.startsWith('get_'))).toBe(true);
      expect((await status()).state.artConnected).toBe(false);
    });
  });
});
