// Frame Home keeper: a background service in the launcher's own package.
//
// What it does (all measured on the TV, docs/phase0-findings.md):
// - It listens to the TV's own art channel, which it reaches from inside the TV with no pairing
//   token. So it knows when Art Mode goes on and off and when the TV says it is going to
//   sleep. The launcher asks it about that sleep notice before it comes back after Art Mode.
// - It keeps one record of what it and the launcher saw, and can report it to the Mac.
// - It is the road for art controls in the launcher later.
//
// What it must not do: open the launcher, or anything else. It cannot see which app is in
// front (Samsung's call returns nothing here), so it cannot tell Samsung's home from a console
// or a cast that has taken over the screen. An earlier version opened the launcher when Art
// Mode ended; that was taken out after review for exactly this reason.
//
// Its limit: after the power key puts the TV into Art Mode, the TV stops this service and the
// launcher within a minute, and starts neither again.
//
// It runs in the TV's service runtime (Node 18 on this TV) with no packages, and it is shipped
// as it is, not built. So it keeps to plain JavaScript and Node's built-in modules.
'use strict';

var http = require('http');
var crypto = require('crypto');

var LAUNCHER = 'FrameHome1.FrameHome';
// The two ports can be moved for tests on a computer, where a fake TV stands in.
var TV_API_PORT = process.env.FRAME_HOME_TV_PORT ? Number(process.env.FRAME_HOME_TV_PORT) : 8001;
var STATUS_PORT = process.env.FRAME_HOME_STATUS_PORT ? Number(process.env.FRAME_HOME_STATUS_PORT) : 47811;
var ART_PATH = '/api/v2/channels/com.samsung.art-app?name=' + Buffer.from('Frame Home keeper', 'utf8').toString('base64');
var ART_ASK_EVERY_MS = process.env.FRAME_HOME_ART_ASK_MS ? Number(process.env.FRAME_HOME_ART_ASK_MS) : 5000;
var ART_RECONNECT_MS = 4000;
// How long /art-probe waits for each answer.
var ART_PROBE_MS = process.env.FRAME_HOME_ART_PROBE_MS ? Number(process.env.FRAME_HOME_ART_PROBE_MS) : 4000;
var BEAT_MS = 5000;
var LOG_LINES = 300;

// Optional: where a debug build reports to (tools/probe-server.mjs on the Mac). The file is
// written by `tools/deploy.mjs --report` and is never part of a normal build.
var reportTo = null;
try {
  reportTo = require('./report-to.json');
} catch (e) {
  reportTo = null;
}
// Optional, also only in a reporting build (`deploy.mjs --report --keeper-art MODE`): how much of
// the art channel to use, for the HDMI test. 'ask' is the normal behaviour, 'listen' connects but
// never asks, 'off' never connects.
var testOptions = {};
try {
  testOptions = reportTo ? require('./test-options.json') : {};
} catch (e) {
  testOptions = {};
}
// FRAME_HOME_ART_USE does the same for tests on a computer.
var artUseWanted = process.env.FRAME_HOME_ART_USE || testOptions.art;
var ART_USE = artUseWanted === 'off' || artUseWanted === 'listen' ? artUseWanted : 'ask';
var artConnects = 0;

var startedAt = Date.now();
var started = false;
var stopped = false;
var beats = 0;
var log = [];
var state = {
  art: 'unknown', // 'on' | 'off' | 'silent' | 'unknown'
  artConnected: false,
  artTo: 'host',
  power: 'unknown',
  launcher: 'unknown',
  lastStandbyAt: 0,
};

/** How the TV says it started this service. */
function startedBy() {
  try {
    var request = tizen.application.getCurrentApplication().getRequestedAppControl();
    return (request.appControl.operation || 'no operation') + ', caller ' + (request.callerAppId || 'none');
  } catch (e) {
    return 'unknown (' + (e && e.message) + ')';
  }
}

function note(text) {
  // Month, day and time in UTC: the record has to make sense the morning after.
  var line = new Date().toISOString().slice(5, 23).replace('T', ' ') + ' ' + text;
  log.push(line);
  if (log.length > LOG_LINES) log.shift();
  report({ type: 'keeper', line: line });
}

function report(event) {
  if (!reportTo) return;
  try {
    var body = JSON.stringify(event);
    var request = http.request({
      host: reportTo.host,
      port: reportTo.port,
      path: '/event',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) },
    });
    request.on('error', function () {});
    request.setTimeout(1500, function () {
      request.abort();
    });
    request.end(body);
  } catch (e) {
    // Reporting is a debugging aid; never let it disturb the service.
  }
}

/** One GET to the TV's own status pages on this device. */
function tvGet(path, done) {
  var finished = false;
  function finish(error, value) {
    if (finished) return;
    finished = true;
    done(error, value);
  }
  try {
    var request = http.get({ host: '127.0.0.1', port: TV_API_PORT, path: path }, function (response) {
      var text = '';
      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        text += chunk;
      });
      response.on('end', function () {
        try {
          finish(null, JSON.parse(text));
        } catch (e) {
          finish(e);
        }
      });
    });
    request.on('error', finish);
    request.setTimeout(1500, function () {
      request.abort();
      finish(new Error('timeout'));
    });
  } catch (e) {
    finish(e);
  }
}

function readTv(done) {
  tvGet('/api/v2/', function (error, info) {
    state.power = error || !info || !info.device ? 'unknown' : String(info.device.PowerState);
    tvGet('/api/v2/applications/' + LAUNCHER, function (error2, app) {
      if (error2 || !app) state.launcher = 'unknown';
      else if (app.code || app.running === false) state.launcher = 'not running';
      else state.launcher = app.visible ? 'on screen' : 'hidden';
      done();
    });
  });
}

// ---- A minimal WebSocket client (RFC 6455), enough for the TV's JSON text frames ----

function openSocket(path, handlers) {
  var key = crypto.randomBytes(16).toString('base64');
  var socket = null;
  var closed = false;
  var pending = Buffer.alloc(0);
  var parts = [];

  function close(why) {
    if (closed) return;
    closed = true;
    try {
      if (socket) socket.destroy();
    } catch (e) {
      // already gone
    }
    handlers.onClose(why);
  }

  function send(opcode, payload) {
    if (!socket || closed) return false;
    var length = payload.length;
    var header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
    }
    header[0] = 0x80 | opcode;
    var mask = crypto.randomBytes(4);
    var masked = Buffer.alloc(length);
    for (var i = 0; i < length; i++) masked[i] = payload[i] ^ mask[i % 4];
    try {
      socket.write(Buffer.concat([header, mask, masked]));
      return true;
    } catch (e) {
      close('write failed');
      return false;
    }
  }

  function feed(chunk) {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 2) return;
      var first = pending[0];
      var second = pending[1];
      var opcode = first & 0x0f;
      var isMasked = (second & 0x80) !== 0;
      var length = second & 0x7f;
      var offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        length = pending.readUInt32BE(2) * 4294967296 + pending.readUInt32BE(6);
        offset = 10;
      }
      if (isMasked) offset += 4;
      if (length > 2 * 1024 * 1024) {
        close('frame too large');
        return;
      }
      if (pending.length < offset + length) return;
      var payload = pending.slice(offset, offset + length);
      if (isMasked) {
        var mask = pending.slice(offset - 4, offset);
        for (var i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      pending = pending.slice(offset + length);
      if (opcode === 8) {
        close('closed by the TV');
        return;
      }
      if (opcode === 9) {
        send(10, payload);
      } else if (opcode === 1 || opcode === 0) {
        parts.push(payload);
        if ((first & 0x80) !== 0) {
          var text = Buffer.concat(parts).toString('utf8');
          parts = [];
          handlers.onText(text);
        }
      }
    }
  }

  try {
    var request = http.request({
      host: '127.0.0.1',
      port: TV_API_PORT,
      path: path,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    request.on('upgrade', function (response, upgraded, head) {
      socket = upgraded;
      socket.on('data', feed);
      socket.on('close', function () {
        close('connection closed');
      });
      socket.on('error', function (e) {
        close('connection error: ' + (e && e.message));
      });
      handlers.onOpen();
      if (head && head.length) feed(head);
    });
    request.on('response', function (response) {
      close('no upgrade, HTTP ' + response.statusCode);
    });
    request.on('error', function (e) {
      close('could not connect: ' + (e && e.message));
    });
    request.end();
  } catch (e) {
    close('could not connect: ' + (e && e.message));
  }

  return {
    sendText: function (text) {
      return send(1, Buffer.from(text, 'utf8'));
    },
    close: function () {
      close('closed by us');
    },
  };
}

// ---- The art channel ----

var art = null;
var artSeq = 0;
var artAskTimer = null;
var artAsked = null; // { id, at }
var artUnanswered = 0;

function askArtStatus() {
  if (!art || stopped || ART_USE !== 'ask') return;
  if (artAsked) {
    // The last question got no reply. In TV mode the art service does not answer at all.
    artUnanswered++;
    if (artUnanswered >= 2) setArt('silent', 'no answer');
    // Some firmware answers only when addressed one way; alternate until something answers.
    if (state.art === 'silent' || state.art === 'unknown') state.artTo = state.artTo === 'host' ? 'broadcast' : 'host';
  }
  var id = 'frame-home-' + Date.now() + '-' + ++artSeq;
  artAsked = { id: id, at: Date.now() };
  var request = { request: 'get_artmode_status', id: id, request_id: id };
  art.sendText(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'art_app_request', to: state.artTo, data: JSON.stringify(request) } }));
}

function onArtMessage(text) {
  var message;
  try {
    message = JSON.parse(text);
  } catch (e) {
    return;
  }
  var event = message.event;
  if (event === 'ms.channel.connect' || event === 'ms.channel.ready') {
    if (!state.artConnected) {
      state.artConnected = true;
      note('art channel ready (' + event + ')');
      askArtStatus();
      artAskTimer = setInterval(askArtStatus, ART_ASK_EVERY_MS);
    }
    return;
  }
  if (event !== 'd2d_service_message') {
    // Connecting from the TV itself makes this service a host of the channel too, so its own
    // questions come back to it.
    if (event && event !== 'art_app_request' && event.indexOf('ms.channel') !== 0) note('art channel event: ' + event);
    return;
  }
  var data = message.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return;
    }
  }
  if (!data || typeof data !== 'object') return;
  if (probe && probeAccept(data)) return;
  var name = data.event;
  var value = data.value || data.status;

  if (name === 'go_to_standby') {
    state.lastStandbyAt = Date.now();
    note('TV says: going to sleep');
    return;
  }
  if (name === 'get_artmode_status' || name === 'artmode_status') {
    if (artAsked && (data.request_id === artAsked.id || data.id === artAsked.id)) {
      artAsked = null;
      artUnanswered = 0;
    }
    if (value === 'on' || value === 'off') setArt(value, 'answer');
    return;
  }
  if (name === 'art_mode_changed' || name === 'artmode_changed') {
    if (value === 'on' || value === 'off') setArt(value, 'announcement');
    return;
  }
  note('art event: ' + name + (value ? ' ' + value : ''));
}

function setArt(value, how) {
  if (state.art === value) return;
  state.art = value;
  note('art mode ' + value + ' (' + how + ')');
}

function connectArt() {
  if (stopped || ART_USE === 'off') return;
  artConnects++;
  if (reportTo) report({ type: 'art-connect', at: new Date().toISOString(), n: artConnects });
  art = openSocket(ART_PATH, {
    onOpen: function () {},
    onText: onArtMessage,
    onClose: function (why) {
      if (artAskTimer) clearInterval(artAskTimer);
      artAskTimer = null;
      artAsked = null;
      artUnanswered = 0;
      if (state.artConnected) note('art channel lost: ' + why);
      state.artConnected = false;
      state.art = 'unknown';
      art = null;
      if (!stopped) setTimeout(connectArt, ART_RECONNECT_MS);
    },
  });
}

// ---- The art probe: which read requests does the TV answer right now? ----
//
// GET /art-probe sends the reads below one after another over the art channel and reports which
// ones got an answer. It sends reads only: every request name must start with `get_`, and
// sendArtRequest refuses anything else. (`api_version`, which this TV also answers, is left out
// for that reason.) It never asks for thumbnails or any binary content.

var ART_PROBE_REQUESTS = [
  { request: 'get_artmode_status' },
  { request: 'get_device_info' },
  { request: 'get_current_artwork' },
  { request: 'get_content_list', params: { category: null } },
  { request: 'get_content_list', params: { category: 'MY-C0002' } },
  { request: 'get_slideshow_status' },
  { request: 'get_auto_rotation_status' },
  { request: 'get_brightness' },
  { request: 'get_color_temperature' },
  { request: 'get_artmode_settings' },
  { request: 'get_matte_list' },
  { request: 'get_photo_filter_list' },
];

var probe = null; // the probe in progress, if any
var IDENTIFYING_KEY = /id|uuid|mac|serial|token|duid/i;
var CONTENT_ID_KEY = /content_id$/;
var CONTENT_ID_VALUE = /^(MY|SAM)[-_]/i;

/** The only place the probe writes to the art channel. */
function sendArtRequest(channel, name, params, id) {
  if (typeof name !== 'string' || name.indexOf('get_') !== 0) throw new Error('refusing to send ' + name + ': the art probe sends reads only');
  var request = { request: name, id: id, request_id: id };
  if (params) {
    for (var key in params) {
      if (key !== 'request' && key !== 'id' && key !== 'request_id') request[key] = params[key];
    }
  }
  return channel.sendText(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'art_app_request', to: 'host', data: JSON.stringify(request) } }));
}

/** A reply copied for the report with everything that could identify the TV or the account removed. */
function scrubReply(value, key, depth) {
  if (depth > 6) return undefined;
  if (key && IDENTIFYING_KEY.test(key) && !(CONTENT_ID_KEY.test(key) && typeof value === 'string' && CONTENT_ID_VALUE.test(value))) return undefined;
  if (typeof value === 'string') {
    var first = value.charAt(0);
    if (first === '[' || first === '{') {
      try {
        return scrubReply(JSON.parse(value), null, depth + 1);
      } catch (e) {
        // not JSON after all; treated as text
      }
    }
    return value
      .replace(/[0-9a-f]{2}(:[0-9a-f]{2}){5}/gi, '(hidden)')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '(hidden)')
      .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '(hidden)');
  }
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return scrubReply(item, null, depth + 1);
    });
  }
  if (value && typeof value === 'object') {
    var copy = {};
    Object.keys(value).forEach(function (k) {
      var kept = scrubReply(value[k], k, depth + 1);
      if (kept !== undefined) copy[k] = kept;
    });
    return copy;
  }
  return value;
}

function describeProbe(spec, data, ms) {
  var entry = { request: spec.request, answered: !!data, ms: ms, keys: data ? Object.keys(data) : [], sample: '' };
  if (spec.params) entry.params = spec.params;
  if (data) {
    try {
      entry.sample = String(JSON.stringify(scrubReply(data, null, 0))).slice(0, 200);
    } catch (e) {
      entry.sample = '(unreadable)';
    }
  }
  return entry;
}

/** Called for every art reply while a probe runs; true when it was the answer being waited for. */
function probeAccept(data) {
  var p = probe;
  if (!p || !p.pendingId || (data.request_id || data.id) !== p.pendingId) return false;
  p.onReply(data);
  return true;
}

function runArtProbe(done) {
  if (probe) {
    done(409, { error: 'an art probe is already running' });
    return;
  }
  var out = { at: new Date().toISOString(), artConnected: false, results: [] };
  var p = { temp: null, channel: null, ready: false, dead: null, pendingId: null, onReply: null, onReady: null };
  probe = p;

  function finish() {
    if (probe === p) probe = null;
    out.artConnected = p.ready;
    if (p.dead && !p.ready) out.error = p.dead;
    if (p.temp) p.temp.close();
    note('art probe: ' + out.results.filter(function (r) { return r.answered; }).length + ' of ' + out.results.length + ' answered');
    done(200, out);
  }

  function waitReady(next) {
    if (p.ready || p.dead) return next();
    var timer = setTimeout(function () {
      p.onReady = null;
      next();
    }, ART_PROBE_MS);
    p.onReady = function () {
      clearTimeout(timer);
      p.onReady = null;
      next();
    };
  }

  function step(i) {
    if (i >= ART_PROBE_REQUESTS.length) return finish();
    var spec = ART_PROBE_REQUESTS[i];
    var id = 'frame-home-probe-' + Date.now() + '-' + ++artSeq;
    var startedAt = Date.now();
    var settled = false;
    var timer = null;
    function settle(data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      p.pendingId = null;
      p.onReply = null;
      out.results.push(describeProbe(spec, data, Date.now() - startedAt));
      step(i + 1);
    }
    timer = setTimeout(function () {
      settle(null);
    }, ART_PROBE_MS);
    p.pendingId = id;
    p.onReply = settle;
    var sent = false;
    try {
      sent = sendArtRequest(p.channel, spec.request, spec.params, id);
    } catch (e) {
      note('art probe: ' + (e && e.message));
    }
    if (!sent) settle(null);
  }

  if (art && state.artConnected) {
    // The keeper's own connection is open: use it.
    p.channel = art;
    p.ready = true;
    step(0);
    return;
  }
  // No connection open (or the test option 'off'): connect just for the probe and close afterwards.
  p.temp = openSocket(ART_PATH, {
    onOpen: function () {},
    onText: function (text) {
      var message;
      try {
        message = JSON.parse(text);
      } catch (e) {
        return;
      }
      if (message.event === 'ms.channel.connect' || message.event === 'ms.channel.ready') {
        p.ready = true;
        if (p.onReady) p.onReady();
        return;
      }
      if (message.event !== 'd2d_service_message') return;
      var data = message.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      if (data && typeof data === 'object') probeAccept(data);
    },
    onClose: function (why) {
      p.dead = why;
      if (p.onReady) p.onReady();
    },
  });
  p.channel = p.temp;
  waitReady(function () {
    step(0);
  });
}

// ---- Status for the launcher and for debugging ----

function status() {
  return {
    service: 'frame-home-keeper',
    startedAt: new Date(startedAt).toISOString(),
    upSeconds: Math.round((Date.now() - startedAt) / 1000),
    beats: beats,
    node: process.version,
    state: state,
    log: log,
  };
}

var server = null;
function startStatusServer() {
  try {
    server = http.createServer(function (request, response) {
      var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
      // The launcher asks before it comes back after Art Mode: has the TV just said it is
      // going to sleep? Only that notice counts; nothing here is inferred.
      if (request.url && request.url.indexOf('/sleep') === 0) {
        var age = state.lastStandbyAt ? Date.now() - state.lastStandbyAt : null;
        response.writeHead(200, headers);
        response.end(JSON.stringify({ sleepNoticeAgeMs: age }));
        return;
      }
      // Which read requests does the art service answer right now? Takes up to a minute.
      if (request.url && request.url.indexOf('/art-probe') === 0) {
        runArtProbe(function (code, body) {
          response.writeHead(code, headers);
          response.end(JSON.stringify(body));
        });
        return;
      }
      // The launcher copies its own record here, where it outlives the launcher's page.
      if (request.url && request.url.indexOf('/note?text=') === 0) {
        var text = '';
        try {
          text = decodeURIComponent(request.url.slice('/note?text='.length)).slice(0, 200);
        } catch (e) {
          text = '(unreadable)';
        }
        note('launcher: ' + text);
        response.writeHead(200, headers);
        response.end('{"ok":true}');
        return;
      }
      response.writeHead(200, headers);
      response.end(JSON.stringify(status()));
    });
    server.on('error', function (e) {
      note('status page not available: ' + (e && e.message));
    });
    server.listen(STATUS_PORT, '127.0.0.1');
  } catch (e) {
    note('status page not available: ' + (e && e.message));
  }
}

/** The app on screen, as Samsung's own API tells it; null when it does not say. */
function foreground() {
  try {
    return webapis.appcommon.getForegroundAppId() || null;
  } catch (e) {
    return null;
  }
}

// Reporting builds only: note every change in which inputs the TV calls connected, to catch a
// console dropping in and out.
var inputsTimer = null;
var lastInputs = null;
function watchInputs() {
  try {
    tizen.systeminfo.getPropertyValue(
      'VIDEOSOURCE',
      function (vs) {
        var name = function (s) {
          return s.type + s.number + (s.signal === null || s.signal === undefined ? '' : s.signal ? '+signal' : '-signal');
        };
        var now = 'connected ' + (vs.connected || []).map(name).join(',') + ' | disconnected ' + (vs.disconnected || []).map(name).join(',');
        if (now !== lastInputs) {
          lastInputs = now;
          note('inputs: ' + now);
        }
      },
      function (e) {
        var text = 'inputs unreadable: ' + (e && e.message);
        if (text !== lastInputs) {
          lastInputs = text;
          note(text);
        }
      }
    );
  } catch (e) {
    var text = 'inputs unreadable: ' + (e && e.message);
    if (text !== lastInputs) {
      lastInputs = text;
      note(text);
    }
  }
}

/** The TV's free memory and the keeper's own size in MB, for heartbeats: does the TV stop our apps when memory runs low? */
function memoryNow() {
  // Never let a reading break the heartbeat: on the TV a module or /proc may be out of reach.
  try {
    var mb = function (bytes) {
      return Math.round(bytes / 1048576);
    };
    var available = null;
    try {
      var line = require('fs')
        .readFileSync('/proc/meminfo', 'utf8')
        .split('\n')
        .filter(function (l) {
          return l.indexOf('MemAvailable:') === 0;
        })[0];
      if (line) available = Math.round(parseInt(line.replace(/\D+/g, ' ').trim(), 10) / 1024);
    } catch (e) {
      available = 'unreadable: ' + e.message;
    }
    var os = require('os');
    var keeperMB = null;
    try {
      keeperMB = mb(process.memoryUsage().rss); // refused on the TV (EACCES)
    } catch (e) {
      keeperMB = null;
    }
    return { availableMB: available, freeMB: mb(os.freemem()), totalMB: mb(os.totalmem()), keeperMB: keeperMB };
  } catch (e) {
    return { error: String(e && e.message) };
  }
}

var beatTimer = null;
function beat() {
  beats++;
  readTv(function () {
    report({
      type: 'heartbeat',
      from: 'keeper',
      at: new Date().toISOString(),
      up: Math.round((Date.now() - startedAt) / 1000),
      art: state.art,
      artConnected: state.artConnected,
      power: state.power,
      launcher: state.launcher,
      front: foreground(),
      memory: memoryNow(),
    });
  });
}

module.exports.onStart = function () {
  if (started) return;
  started = true;
  var hasTizen = typeof tizen !== 'undefined' ? 'yes' : 'no';
  var hasWebapis = typeof webapis !== 'undefined' ? 'yes' : 'no';
  note('keeper started; node ' + process.version + ', tizen ' + hasTizen + ', webapis ' + hasWebapis + '; ' + startedBy());
  startStatusServer();
  connectArt();
  // Heartbeats exist only to be reported, so a normal build sends none.
  if (reportTo) {
    note('test: art channel use ' + ART_USE);
    beat();
    beatTimer = setInterval(beat, BEAT_MS);
    watchInputs();
    inputsTimer = setInterval(watchInputs, 1000);
  }
};

module.exports.onRequest = function () {
  note('keeper asked again: ' + startedBy());
};

module.exports.onStop = function () {
  note('keeper told to stop');
  stopped = true;
  if (beatTimer) clearInterval(beatTimer);
  if (inputsTimer) clearInterval(inputsTimer);
  if (art) art.close();
  if (probe && probe.temp) probe.temp.close();
  if (server) server.close();
};
module.exports.onExit = module.exports.onStop;
