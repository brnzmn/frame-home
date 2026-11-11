#!/usr/bin/env node
// Receives what our apps on the TV post: the probe's report, and the lines the launcher's
// background service reports when installed with `tools/deploy.mjs --report`.
//   POST /report  full report  -> docs/probe-report.json
//   POST /event   one event    -> printed, and appended to docs/private/probe-events.log
//   GET  /health  reachability check used by the probe itself
//
//   node tools/probe-server.mjs [--log FILE]    FILE instead of probe-events.log, so each test
//                                               run can keep its own log. Logs are only appended to.
// Bodies are sent as text/plain so the TV's browser skips the CORS preflight.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PROBE_PORT ?? 8787);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportFile = path.join(root, 'docs', 'probe-report.json');
const logFlag = process.argv.indexOf('--log');
const eventsFile = logFlag >= 0 ? path.resolve(process.argv[logFlag + 1]) : path.join(root, 'docs', 'private', 'probe-events.log');
fs.mkdirSync(path.dirname(eventsFile), { recursive: true });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (req.method === 'POST' && (req.url === '/report' || req.url === '/event')) {
      const data = JSON.parse(await readBody(req));
      if (req.url === '/report') {
        fs.writeFileSync(reportFile, JSON.stringify(data, null, 2) + '\n');
        console.log(`REPORT received: ${Object.keys(data.checks ?? {}).length} checks, ${(data.apps ?? []).length} apps`);
      } else {
        const line = JSON.stringify(data);
        fs.appendFileSync(eventsFile, line + '\n');
        if (data.type !== 'heartbeat') console.log(`EVENT ${line}`);
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404, cors).end();
  } catch (err) {
    res.writeHead(400, cors).end(String(err?.message ?? err));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`probe server listening on :${PORT}`));
