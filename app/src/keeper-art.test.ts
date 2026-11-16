// @ts-nocheck: this test runs in Node and the project carries no Node type definitions.
// The keeper's picture cache and its one write (select_image), against a fake TV: the art channel
// as a WebSocket, and the separate socket that streams thumbnails, in the format the samsungtvws
// family of clients reads (4-byte big-endian header length, JSON header, image bytes).
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const KEEPER = require.resolve('../public/service/keeper.js');

/** One thumbnail as the TV streams it. */
function thumbRecord(id: string, data: Buffer, num: number, total: number, fileType = 'jpg'): Buffer {
  const header = Buffer.from(JSON.stringify({ num, total, fileLength: data.length, fileID: id, fileType }), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  return Buffer.concat([length, header, data]);
}

const picture = (id: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`fake jpeg of ${id} `.repeat(40))]);

function frame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

interface FakeTv {
  port: number;
  /** Art Mode on and the art service answering; false is TV mode, where it answers nothing. */
  answering: boolean;
  /** Every request the TV was sent, whole. */
  requests: any[];
  lists: Record<string, any[]>;
  slideshow: any[];
  /** Cut the thumbnail stream after this many images (a TV stopping the keeper half-way). */
  cutAfter: number | null;
  /** Answer only this many thumbnail requests, then fall silent. */
  thumbAnswers: number | null;
  close(): Promise<void>;
}

async function startFakeTv(): Promise<FakeTv> {
  const sockets = new Set<Duplex>();
  const thumbServers = new Set<net.Server>();
  const tv: FakeTv = {
    port: 0,
    answering: true,
    requests: [],
    lists: {
      'MY-C0002': [{ content_id: 'MY_F0001' }, { content_id: 'MY_F0002' }],
      'MY-C0004': [],
      'MY-C0008': [{ content_id: 'SAM-S0001', category_id: 'MY-C0008' }, { content_id: 'MY_F0002' }, { content_id: 'MY_F0003' }],
    },
    slideshow: [{ content_id: 'SAM-S0002' }, { content_id: 'SAM-S0003' }, { content_id: 'SAM-S0004' }],
    cutAfter: null,
    thumbAnswers: null,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        for (const t of thumbServers) t.close();
        server.close(() => resolve());
      }),
  };
  const say = (event: Record<string, unknown>): void => {
    for (const s of sockets) s.write(frame(JSON.stringify({ event: 'd2d_service_message', data: JSON.stringify(event) })));
  };

  function streamThumbs(ids: string[], requestId: string): void {
    const thumbs = net.createServer((socket) => {
      const records = ids.map((id, i) => thumbRecord(id, picture(id), i, ids.length));
      const sent = tv.cutAfter === null ? records : records.slice(0, tv.cutAfter);
      // Written in small pieces, the way a real socket delivers them.
      const all = Buffer.concat(sent);
      for (let i = 0; i < all.length; i += 97) socket.write(all.subarray(i, i + 97));
      socket.end();
      thumbs.close();
    });
    thumbServers.add(thumbs);
    thumbs.listen(0, '127.0.0.1', () => {
      const port = (thumbs.address() as AddressInfo).port;
      say({ event: 'ready_to_use', request_id: requestId, conn_info: JSON.stringify({ ip: '127.0.0.1', port: String(port), key: 'k', secured: false }) });
    });
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ device: { PowerState: 'on' } }));
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
        const request = JSON.parse(JSON.parse(payload.toString('utf8')).params.data);
        tv.requests.push(request);
        if (!tv.answering) continue;
        const id = request.request_id;
        switch (request.request) {
          case 'get_artmode_status':
            say({ event: 'get_artmode_status', request_id: id, value: 'on' });
            break;
          case 'get_content_list':
            say({ event: 'get_content_list', request_id: id, content_list: JSON.stringify(tv.lists[request.category] ?? []) });
            break;
          case 'get_slideshow_status':
            say({ event: 'get_slideshow_status', request_id: id, value: '5', category_id: 'ARTSTREAM', content_list: JSON.stringify(tv.slideshow) });
            break;
          case 'get_thumbnail_list':
            if (tv.thumbAnswers !== null && tv.thumbAnswers-- <= 0) break;
            streamThumbs(request.content_id_list.map((c: any) => c.content_id), id);
            break;
          case 'select_image':
            say({ event: 'select_image', request_id: id });
            break;
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  tv.port = (server.address() as AddressInfo).port;
  return tv;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) return true;
    } catch {
      // The status page is between keepers (a restart in the test); ask again.
    }
    await wait(25);
  }
  return false;
}

let tv: FakeTv | undefined;
let keeper: any;
let statusPort = 0;
let cacheDir = '';

function loadKeeper(env: Record<string, string> = {}): any {
  process.env.FRAME_HOME_TV_PORT = String(tv!.port);
  // Port 0: a free port, read back once it listens, so parallel test files never collide.
  process.env.FRAME_HOME_STATUS_PORT = '0';
  process.env.FRAME_HOME_ART_ASK_MS = '100';
  process.env.FRAME_HOME_ART_CALL_MS = '400';
  process.env.FRAME_HOME_THUMB_SOCKET_MS = '1000';
  process.env.FRAME_HOME_ART_CACHE = cacheDir;
  delete process.env.FRAME_HOME_CHOICE_TTL_MS;
  delete process.env.FRAME_HOME_ART_USE;
  Object.assign(process.env, env);
  delete require.cache[KEEPER];
  const loaded = require(KEEPER);
  loaded.onStart();
  return loaded;
}

async function loadKeeperListening(env: Record<string, string> = {}): Promise<any> {
  const loaded = loadKeeper(env);
  await until(() => Boolean(loaded._forTests.statusPort()));
  statusPort = loaded._forTests.statusPort();
  return loaded;
}

async function start(answering: boolean, env: Record<string, string> = {}): Promise<void> {
  tv = await startFakeTv();
  tv.answering = answering;
  cacheDir = mkdtempSync(join(tmpdir(), 'frame-home-art-'));
  keeper = await loadKeeperListening(env);
}

afterEach(async () => {
  keeper?.onStop();
  await tv?.close();
  keeper = undefined;
  tv = undefined;
});

const get = async (path: string): Promise<Response> => fetch(`http://127.0.0.1:${statusPort}${path}`);
const list = async (): Promise<any> => (await get('/art/list')).json();
const sentNames = (): string[] => tv!.requests.map((r) => r.request);
const ALL_IDS = ['MY_F0001', 'MY_F0002', 'MY_F0003', 'SAM-S0001', 'SAM-S0002', 'SAM-S0003', 'SAM-S0004'];

describe('the keeper\'s art request guard', () => {
  const { artRequestAllowed, sendArtRequest } = require(KEEPER)._forTests;

  it('allows reads and select_image, and nothing else', () => {
    for (const name of ['get_content_list', 'get_thumbnail_list', 'get_artmode_status', 'select_image']) expect(artRequestAllowed(name)).toBe(true);
    for (const name of ['change_matte', 'set_brightness', 'delete_image_list', 'send_image', 'set_slideshow_status', 'select_image_list', 'Select_image', '', undefined, null]) {
      expect(artRequestAllowed(name)).toBe(false);
    }
  });

  it('refuses change_matte before anything is written to the channel', () => {
    const written: string[] = [];
    const channel = { sendText: (text: string) => written.push(text) > 0 };
    expect(() => sendArtRequest(channel, 'change_matte', { content_id: 'MY_F0001', matte_id: 'none' }, 'x')).toThrow(/refusing/);
    expect(written).toEqual([]);
  });

  it('sends select_image with only the picture, its category and show', () => {
    const written: string[] = [];
    const channel = { sendText: (text: string) => written.push(text) > 0 };
    sendArtRequest(channel, 'select_image', { content_id: 'MY_F0001', category_id: 'MY-C0002', show: true, matte_id: 'none', portrait_matte_id: 'none' }, 'id1');
    const data = JSON.parse(JSON.parse(written[0]).params.data);
    expect(data).toEqual({ request: 'select_image', id: 'id1', request_id: 'id1', content_id: 'MY_F0001', category_id: 'MY-C0002', show: true });
  });
});

describe('the thumbnail stream reader', () => {
  const { createThumbReader } = require(KEEPER)._forTests;
  const a = picture('MY_F0001');
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const stream = Buffer.concat([thumbRecord('MY_F0001', a, 0, 2), thumbRecord('SAM-S0001', b, 1, 2, 'png')]);

  it('reads every image however the bytes are cut', () => {
    for (const size of [1, 3, 4, 7, 64, stream.length]) {
      const files: any[] = [];
      const reader = createThumbReader((header: any, data: Buffer) => files.push({ id: header.fileID, type: header.fileType, data }));
      for (let i = 0; i < stream.length; i += size) reader.feed(stream.subarray(i, i + size));
      expect(files.map((f) => f.id)).toEqual(['MY_F0001', 'SAM-S0001']);
      expect(files[0].data.equals(a)).toBe(true);
      expect(files[1].data.equals(b)).toBe(true);
      expect(files[1].type).toBe('png');
      expect(reader.complete()).toBe(true);
    }
  });

  it('is not complete until the last of `total` has arrived', () => {
    const reader = createThumbReader(() => {});
    reader.feed(stream.subarray(0, stream.length - 1));
    expect(reader.count()).toBe(1);
    expect(reader.complete()).toBe(false);
  });

  it('refuses a header that cannot be right', () => {
    const bad = Buffer.alloc(8);
    bad.writeUInt32BE(10_000_000, 0);
    expect(() => createThumbReader(() => {}).feed(bad)).toThrow(/header length/);
    const huge = thumbRecord('MY_F0001', Buffer.alloc(0), 0, 1);
    const header = JSON.stringify({ num: 0, total: 1, fileLength: 50 * 1024 * 1024, fileID: 'MY_F0001', fileType: 'jpg' });
    huge.writeUInt32BE(header.length, 0);
    expect(() => createThumbReader(() => {}).feed(Buffer.concat([huge.subarray(0, 4), Buffer.from(header)]))).toThrow(/size/);
  });
});

describe('a queued choice', () => {
  const { choiceExpired, CHOICE_TTL_MS } = require(KEEPER)._forTests;
  it('lasts about two minutes', () => {
    expect(CHOICE_TTL_MS).toBe(120000);
    expect(choiceExpired({ id: 'MY_F0001', at: 1000 }, 1000 + CHOICE_TTL_MS - 1)).toBe(false);
    expect(choiceExpired({ id: 'MY_F0001', at: 1000 }, 1000 + CHOICE_TTL_MS)).toBe(true);
    expect(choiceExpired(null, 0)).toBe(true);
  });
});

describe('the picture cache, against a fake TV', () => {
  it('caches the list, own uploads first, and writes every thumbnail while Art Mode answers', async () => {
    await start(true);
    expect(await until(async () => (await list()).thumbnails === ALL_IDS.length)).toBe(true);
    const page = await list();
    expect(page.store).toBe('disk');
    expect(page.items.map((i: any) => i.id)).toEqual(ALL_IDS);
    expect(page.items.map((i: any) => i.kind)).toEqual(['mine', 'mine', 'mine', 'store', 'store', 'store', 'store']);
    expect(page.items.every((i: any) => i.thumb)).toBe(true);
    // Small batches: never more than four at once.
    const batches = tv!.requests.filter((r) => r.request === 'get_thumbnail_list');
    expect(batches.length).toBe(2);
    expect(batches.every((r) => r.content_id_list.length <= 4 && r.conn_info.d2d_mode === 'socket')).toBe(true);
    // On disk, whole files only.
    expect(JSON.parse(readFileSync(join(cacheDir, 'list.json'), 'utf8')).items.length).toBe(ALL_IDS.length);
    const files = readdirSync(join(cacheDir, 'thumbs')).sort();
    expect(files).toEqual(ALL_IDS.map((id) => `${id}.jpg`).sort());
    // Reads only, and no select_image when nothing was chosen.
    expect(sentNames().filter((n) => !n.startsWith('get_'))).toEqual([]);
  });

  it('serves a thumbnail\'s bytes, and 404 for anything else', async () => {
    await start(true);
    await until(async () => (await list()).thumbnails === ALL_IDS.length);
    const reply = await get('/art/thumb/MY_F0002');
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await reply.arrayBuffer()).equals(picture('MY_F0002'))).toBe(true);
    expect((await get('/art/thumb/MY_NOPE')).status).toBe(404);
    expect((await get('/art/thumb/..%2Flist.json')).status).toBe(404);
  });

  it('keeps what arrived when cut off half-way, and later fetches only what is missing', async () => {
    await start(false);
    tv!.cutAfter = 2;
    tv!.thumbAnswers = 1;
    tv!.answering = true;
    expect(await until(async () => (await list()).lastRefresh?.startsWith('thumbnails stopped') ?? false)).toBe(true);
    const page = await list();
    expect(page.pictures).toBe(ALL_IDS.length);
    expect(page.items.filter((i: any) => i.thumb).map((i: any) => i.id)).toEqual(['MY_F0001', 'MY_F0002']);
    expect(readdirSync(join(cacheDir, 'thumbs')).sort()).toEqual(['MY_F0001.jpg', 'MY_F0002.jpg']);

    // The next time Art Mode answers (a new keeper, as after the TV stopped it), only the rest.
    keeper.onStop();
    tv!.cutAfter = null;
    tv!.thumbAnswers = null;
    tv!.requests = [];
    await wait(100);
    keeper = await loadKeeperListening();
    expect(await until(async () => (await list()).thumbnails === ALL_IDS.length)).toBe(true);
    const asked = tv!.requests.filter((r) => r.request === 'get_thumbnail_list').flatMap((r) => r.content_id_list.map((c: any) => c.content_id));
    expect(asked.sort()).toEqual(ALL_IDS.slice(2).sort());
  });

  it('serves the cache after a restart with the TV silent', async () => {
    await start(true);
    await until(async () => (await list()).thumbnails === ALL_IDS.length);
    keeper.onStop();
    tv!.answering = false;
    await wait(100);
    keeper = await loadKeeperListening();
    await until(async () => (await get('/art/list')).ok);
    const page = await list();
    expect(page.items.map((i: any) => i.id)).toEqual(ALL_IDS);
    expect(page.thumbnails).toBe(ALL_IDS.length);
    expect((await get('/art/thumb/SAM-S0004')).status).toBe(200);
  });

  it('keeps the pictures in memory when it can write nowhere', async () => {
    tv = await startFakeTv();
    const blocker = join(mkdtempSync(join(tmpdir(), 'frame-home-block-')), 'a-file');
    writeFileSync(blocker, 'not a folder');
    cacheDir = join(blocker, 'cache');
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = blocker;
    try {
      keeper = await loadKeeperListening();
      expect(await until(async () => (await list()).thumbnails === ALL_IDS.length)).toBe(true);
      const page = await list();
      expect(page.store).toBe('memory');
      expect(Buffer.from(await (await get('/art/thumb/MY_F0001')).arrayBuffer()).equals(picture('MY_F0001'))).toBe(true);
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
    }
  });
});

describe('choosing a picture', () => {
  async function cachedThenSilent(env: Record<string, string> = {}): Promise<void> {
    await start(true, env);
    await until(async () => (await list()).thumbnails === ALL_IDS.length);
    tv!.answering = false;
    await wait(200);
  }

  it('refuses ids that are not listed pictures', async () => {
    await cachedThenSilent();
    expect((await get('/art/choose?id=')).status).toBe(400);
    expect((await get('/art/choose?id=..%2Fx')).status).toBe(400);
    expect((await get('/art/choose?id=MY_NOT_LISTED')).status).toBe(404);
  });

  it('sends nothing while the art service is silent, then select_image once when it answers', async () => {
    await cachedThenSilent();
    const before = tv!.requests.length;
    const queued = await (await fetch(`http://127.0.0.1:${statusPort}/art/choose?id=SAM-S0002`, { method: 'POST' })).json();
    expect(queued).toMatchObject({ ok: true, queued: 'SAM-S0002' });
    await wait(600);
    const whileSilent = tv!.requests.slice(before).map((r) => r.request);
    expect(whileSilent.length).toBeGreaterThan(0);
    expect(whileSilent.filter((n) => n !== 'get_artmode_status')).toEqual([]);
    expect((await list()).choice).toMatchObject({ id: 'SAM-S0002' });
    expect(existsSync(join(cacheDir, 'choice.json'))).toBe(true);

    tv!.answering = true;
    expect(await until(() => sentNames().includes('select_image'))).toBe(true);
    await wait(500);
    const selects = tv!.requests.filter((r) => r.request === 'select_image');
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatchObject({ content_id: 'SAM-S0002', category_id: null, show: true });
    const page = await list();
    expect(page.choice).toBeNull();
    expect(page.lastChoice).toMatchObject({ id: 'SAM-S0002', answer: 'select_image' });
    expect(existsSync(join(cacheDir, 'choice.json'))).toBe(false);
    expect(sentNames().filter((n) => !n.startsWith('get_') && n !== 'select_image')).toEqual([]);
  });

  it('sends at once when Art Mode is already on', async () => {
    await start(true);
    await until(async () => (await list()).thumbnails === ALL_IDS.length);
    await get('/art/choose?id=MY_F0003');
    expect(await until(() => sentNames().includes('select_image'), 1000)).toBe(true);
    expect(tv!.requests.find((r) => r.request === 'select_image')).toMatchObject({ content_id: 'MY_F0003', category_id: null, show: true });
  });

  it('drops a choice that waited too long', async () => {
    await cachedThenSilent({ FRAME_HOME_CHOICE_TTL_MS: '300' });
    await get('/art/choose?id=MY_F0001');
    await wait(500);
    tv!.answering = true;
    await wait(800);
    expect(sentNames()).not.toContain('select_image');
    expect((await list()).choice).toBeNull();
  });
});
