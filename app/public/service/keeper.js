// Frame Home keeper: a background service in the launcher's own package.
//
// What it does (all measured on the TV, docs/phase0-findings.md):
// - It listens to the TV's own art channel, which it reaches from inside the TV with no pairing
//   token. So it knows when Art Mode goes on and off and when the TV says it is going to
//   sleep. The launcher asks it about that sleep notice before it comes back after Art Mode.
// - It keeps one record of what it and the launcher saw, and can report it to the Mac.
// - It keeps the launcher's picture list for the Choose art screen. The art service answers only
//   while Art Mode is on, so whenever it does answer the keeper copies the list and small
//   thumbnails into a cache, and serves them to the launcher from there at any time.
// - It holds the one change the launcher may ask for, "show this picture", until Art Mode is on
//   and the art service answers, then sends it (select_image) and forgets it.
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
var fs = require('fs');
var path = require('path');
var net = require('net');
var tls = require('tls');
var os = require('os');

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
var envMs = function (name, fallback) {
  return process.env[name] ? Number(process.env[name]) : fallback;
};
// The picture cache for the Choose art screen.
var PACKAGE = LAUNCHER.split('.')[0];
/** How long one art request may wait for its answer. */
var ART_CALL_MS = envMs('FRAME_HOME_ART_CALL_MS', 8000);
/** How long the separate socket that streams thumbnails may stay quiet. */
var THUMB_SOCKET_MS = envMs('FRAME_HOME_THUMB_SOCKET_MS', 15000);
/** Thumbnails asked for at once: small batches, so a cut-off run still leaves most of them written. */
var THUMB_BATCH = 4;
var THUMB_MAX_BYTES = 4 * 1024 * 1024;
/** At most this many pictures (and thumbnails) are kept; fewer when only memory is available. */
var ART_CACHE_MAX = 200;
var ART_MEMORY_MAX = 60;
/** The list is read again at most this often while Art Mode stays on. */
var ART_REFRESH_EVERY_MS = envMs('FRAME_HOME_ART_REFRESH_MS', 10 * 60 * 1000);
/** A chosen picture still waiting after this long is dropped: the owner has moved on. */
var CHOICE_TTL_MS = envMs('FRAME_HOME_CHOICE_TTL_MS', 2 * 60 * 1000);
/** Content ids as the TV writes them ("MY_F0042", "SAM-S1111996"). Anything else is refused. */
var ART_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
  dropExpiredChoice();
  sendArtStatusQuestion();
}

function sendArtStatusQuestion() {
  var id = 'frame-home-' + Date.now() + '-' + ++artSeq;
  artAsked = { id: id, at: Date.now() };
  var request = { request: 'get_artmode_status', id: id, request_id: id };
  art.sendText(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'art_app_request', to: state.artTo, data: JSON.stringify(request) } }));
}

/** Ask now instead of at the next tick, without counting the open question as unanswered. */
function askArtSoon(ms) {
  setTimeout(function () {
    if (art && state.artConnected && !stopped && ART_USE === 'ask') sendArtStatusQuestion();
  }, ms);
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
  if (artCallAccept(data)) return;
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
    // An answer, and Art Mode on: the one moment the art service will take requests.
    if (value === 'on') artAnswersNow();
    return;
  }
  if (name === 'art_mode_changed' || name === 'artmode_changed') {
    if (value === 'on' || value === 'off') setArt(value, 'announcement');
    // The service needs a moment after the announcement; ask then rather than at the next tick.
    if (value === 'on') askArtSoon(1000);
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
      failArtCalls('art channel lost');
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
// ones got an answer. It sends reads only: every request name must start with `get_` (and
// sendArtRequest refuses anything but reads and select_image). (`api_version`, which this TV also answers, is left out
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

/**
 * The only requests that may ever go to the art service: reads (`get_...`) and exactly one change,
 * `select_image` (show this picture). Never a mat, a setting, an upload or a delete: some of those
 * cannot be undone on this TV (docs/phase0-findings.md).
 */
function artRequestAllowed(name) {
  return typeof name === 'string' && (name.indexOf('get_') === 0 || name === 'select_image');
}
/** The only fields `select_image` may carry. */
var SELECT_IMAGE_FIELDS = { content_id: true, category_id: true, show: true };

/** The only place anything writes a request to the art channel. */
function sendArtRequest(channel, name, params, id, to) {
  if (!artRequestAllowed(name)) throw new Error('refusing to send ' + name + ': only reads and select_image are allowed');
  var request = { request: name, id: id, request_id: id };
  if (params) {
    for (var key in params) {
      if (key === 'request' || key === 'id' || key === 'request_id') continue;
      if (name === 'select_image' && !SELECT_IMAGE_FIELDS[key]) continue;
      request[key] = params[key];
    }
  }
  return channel.sendText(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'art_app_request', to: to || 'host', data: JSON.stringify(request) } }));
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

// ---- Art requests that wait for their answer, on the keeper's own connection ----

var artCalls = {}; // request id -> { name, wants, done, timer }

/**
 * Send one allowed request and call `done(error, reply)` once. `wants` names a field the answer
 * must carry; other messages with the same id (acknowledgements) are passed over.
 */
function artCall(name, params, ms, done, wants) {
  if (!art || !state.artConnected) {
    done(new Error('art channel not open'));
    return;
  }
  var id = 'frame-home-' + Date.now() + '-' + ++artSeq;
  var call = { name: name, wants: wants || null, done: done, timer: null };
  call.timer = setTimeout(function () {
    delete artCalls[id];
    done(new Error('no answer to ' + name));
  }, ms);
  artCalls[id] = call;
  var sent = false;
  try {
    sent = sendArtRequest(art, name, params, id, state.artTo);
  } catch (e) {
    clearTimeout(call.timer);
    delete artCalls[id];
    done(e);
    return;
  }
  if (!sent) {
    clearTimeout(call.timer);
    delete artCalls[id];
    done(new Error('could not send ' + name));
  }
}

/** Called for every art reply; true when it answered one of our waiting requests. */
function artCallAccept(data) {
  var id = data.request_id || data.id;
  var call = id ? artCalls[id] : null;
  if (!call && data.event === 'ready_to_use') {
    // Some firmware leaves the id off the thumbnail answer. Take it only when exactly one
    // thumbnail request is waiting, so it cannot be given to the wrong one.
    var waiting = Object.keys(artCalls).filter(function (k) {
      return artCalls[k].wants === 'conn_info';
    });
    if (waiting.length === 1) {
      id = waiting[0];
      call = artCalls[id];
    }
  }
  if (!call) return false;
  if (data.event !== 'error' && call.wants && data[call.wants] === undefined) return true;
  clearTimeout(call.timer);
  delete artCalls[id];
  if (data.event === 'error') call.done(new Error(call.name + ': error ' + data.error_code));
  else call.done(null, data);
  return true;
}

function failArtCalls(why) {
  Object.keys(artCalls).forEach(function (id) {
    var call = artCalls[id];
    delete artCalls[id];
    clearTimeout(call.timer);
    call.done(new Error(why));
  });
}

/** The art service answered, with Art Mode on: send a waiting choice, then refresh the cache. */
function artAnswersNow() {
  flushChoice();
  maybeRefreshArt();
}

// ---- The picture cache for the Choose art screen ----
//
// On disk when the keeper can write somewhere, in memory otherwise:
//   <dir>/list.json        the pictures, own uploads first: [{ id, kind, category }]
//   <dir>/thumbs/<id>.jpg  one small image per picture, written the moment it arrives
//   <dir>/choice.json      a chosen picture still waiting for Art Mode
// Where the keeper may write on the TV is not known yet; the first folder that takes a test write
// wins: FRAME_HOME_ART_CACHE, the app's own data folder, then the system's temporary folder.

var artCache = { dir: null, items: [], updatedAt: 0, thumbs: {}, memory: {}, memoryOrder: [] };
var artRefresh = { running: false, lastAt: 0, lastResult: null, singleThumbs: false };
var choice = null; // { id, category, at }
var lastChoice = null; // { id, sentAt, answer }

function cacheDirCandidates() {
  var list = [];
  if (process.env.FRAME_HOME_ART_CACHE) list.push(process.env.FRAME_HOME_ART_CACHE);
  // On Tizen an app's own writable folder is <home>/apps_rw/<package>/data. Only used when the
  // package folder is already there, so a test run on a computer leaves nothing behind.
  var home = process.env.HOME || '/opt/usr/home/owner';
  var appRw = path.join(home, 'apps_rw', PACKAGE);
  try {
    if (fs.existsSync(appRw)) list.push(path.join(appRw, 'data', 'art-cache'));
  } catch (e) {
    // not readable: skip it
  }
  try {
    list.push(path.join(os.tmpdir(), 'frame-home-art-cache'));
  } catch (e) {
    // no temporary folder
  }
  return list;
}

function pickCacheDir() {
  var candidates = cacheDirCandidates();
  for (var i = 0; i < candidates.length; i++) {
    var dir = candidates[i];
    try {
      fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
      var probeFile = path.join(dir, '.write-test');
      fs.writeFileSync(probeFile, 'ok');
      fs.unlinkSync(probeFile);
      return dir;
    } catch (e) {
      note('art cache: cannot write ' + dir + ' (' + (e && e.code) + ')');
    }
  }
  return null;
}

/** Write a file whole or not at all: a cut-off write never leaves half a picture behind. */
function writeWhole(file, data) {
  var part = file + '.part';
  fs.writeFileSync(part, data);
  fs.renameSync(part, file);
}

function useMemoryOnly(why) {
  if (!artCache.dir) return;
  note('art cache: keeping pictures in memory only (' + why + ')');
  artCache.dir = null;
  artCache.thumbs = {};
  if (artCache.items.length > ART_MEMORY_MAX) artCache.items = artCache.items.slice(0, ART_MEMORY_MAX);
}

function loadArtCache() {
  artCache.dir = pickCacheDir();
  if (!artCache.dir) {
    note('art cache: in memory only');
    return;
  }
  try {
    var saved = JSON.parse(fs.readFileSync(path.join(artCache.dir, 'list.json'), 'utf8'));
    if (saved && Array.isArray(saved.items)) {
      artCache.items = saved.items
        .filter(function (item) {
          return item && ART_ID.test(item.id);
        })
        .slice(0, ART_CACHE_MAX);
      artCache.updatedAt = Number(saved.updatedAt) || 0;
    }
  } catch (e) {
    // no list yet
  }
  try {
    fs.readdirSync(path.join(artCache.dir, 'thumbs')).forEach(function (file) {
      var match = /^([A-Za-z0-9_-]{1,64})\.(jpg|png|webp)$/.exec(file);
      if (match) artCache.thumbs[match[1]] = file;
    });
  } catch (e) {
    // no thumbnails yet
  }
  try {
    var waiting = JSON.parse(fs.readFileSync(path.join(artCache.dir, 'choice.json'), 'utf8'));
    if (waiting && ART_ID.test(waiting.id) && !choiceExpired(waiting, Date.now())) choice = waiting;
  } catch (e) {
    // nothing waiting
  }
  note('art cache: ' + artCache.items.length + ' pictures, ' + Object.keys(artCache.thumbs).length + ' thumbnails' + (choice ? ', a choice waiting' : ''));
}

function itemById(id) {
  for (var i = 0; i < artCache.items.length; i++) if (artCache.items[i].id === id) return artCache.items[i];
  return null;
}

function hasThumb(id) {
  return artCache.dir ? !!artCache.thumbs[id] : !!artCache.memory[id];
}

/** Own uploads first, then the rest in the order the TV listed them; one entry per picture, bounded. */
function mergeArtLists(lists) {
  var seen = {};
  var mine = [];
  var store = [];
  lists.forEach(function (list) {
    list.forEach(function (item) {
      if (!item || !ART_ID.test(item.id) || seen[item.id]) return;
      seen[item.id] = true;
      (item.id.indexOf('MY') === 0 ? mine : store).push(item);
    });
  });
  return mine.concat(store).slice(0, artCache.dir ? ART_CACHE_MAX : ART_MEMORY_MAX);
}

function saveArtList(items) {
  artCache.items = items;
  artCache.updatedAt = Date.now();
  if (artCache.dir) {
    try {
      writeWhole(path.join(artCache.dir, 'list.json'), JSON.stringify({ updatedAt: artCache.updatedAt, items: items }));
    } catch (e) {
      useMemoryOnly('list not written: ' + (e && e.code));
    }
  }
  // Keep the cache bounded: thumbnails of pictures no longer listed go.
  if (artCache.dir) {
    Object.keys(artCache.thumbs).forEach(function (id) {
      if (itemById(id)) return;
      try {
        fs.unlinkSync(path.join(artCache.dir, 'thumbs', artCache.thumbs[id]));
      } catch (e) {
        // already gone
      }
      delete artCache.thumbs[id];
    });
  } else {
    artCache.memoryOrder = artCache.memoryOrder.filter(function (id) {
      if (itemById(id)) return true;
      delete artCache.memory[id];
      return false;
    });
  }
}

var THUMB_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function saveThumb(id, fileType, data) {
  if (!ART_ID.test(String(id)) || !itemById(id)) return false;
  var ext = String(fileType || 'jpg').toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (!THUMB_TYPES[ext]) ext = 'jpg';
  if (artCache.dir) {
    try {
      var file = id + '.' + ext;
      writeWhole(path.join(artCache.dir, 'thumbs', file), data);
      if (artCache.thumbs[id] && artCache.thumbs[id] !== file) {
        try {
          fs.unlinkSync(path.join(artCache.dir, 'thumbs', artCache.thumbs[id]));
        } catch (e) {
          // already gone
        }
      }
      artCache.thumbs[id] = file;
      return true;
    } catch (e) {
      useMemoryOnly('thumbnail not written: ' + (e && e.code));
    }
  }
  if (!artCache.memory[id]) artCache.memoryOrder.push(id);
  artCache.memory[id] = { type: THUMB_TYPES[ext], data: data };
  while (artCache.memoryOrder.length > ART_MEMORY_MAX) delete artCache.memory[artCache.memoryOrder.shift()];
  return true;
}

/** The thumbnail's bytes and type, or null. */
function readThumb(id, done) {
  if (artCache.dir && artCache.thumbs[id]) {
    var file = artCache.thumbs[id];
    fs.readFile(path.join(artCache.dir, 'thumbs', file), function (error, data) {
      if (error) return done(null);
      done({ type: THUMB_TYPES[file.split('.').pop()] || 'image/jpeg', data: data });
    });
    return;
  }
  done(artCache.memory[id] || null);
}

/** The pictures of one answer to get_content_list or get_slideshow_status. */
function contentItems(reply, category) {
  var list = reply && reply.content_list;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(function (item) {
      return item && typeof item.content_id === 'string';
    })
    .map(function (item) {
      var id = item.content_id;
      return { id: id, kind: id.indexOf('MY') === 0 ? 'mine' : 'store', category: item.category_id || (reply && reply.category_id) || category || null };
    });
}

// Where the pictures are listed: own uploads, favourites, recently shown (Art Store included),
// and the running slideshow. All reads.
var ART_LIST_SOURCES = [
  { request: 'get_content_list', params: { category: 'MY-C0002' } },
  { request: 'get_content_list', params: { category: 'MY-C0004' } },
  { request: 'get_content_list', params: { category: 'MY-C0008' } },
  { request: 'get_slideshow_status' },
];

function maybeRefreshArt() {
  if (artRefresh.running || stopped) return;
  if (artRefresh.lastAt && Date.now() - artRefresh.lastAt < ART_REFRESH_EVERY_MS) return;
  refreshArtCache();
}

/**
 * List first (written as soon as it is in), then thumbnails in small batches, each written as it
 * arrives. The TV may stop the keeper at any moment in Art Mode; whatever got written stays.
 */
function refreshArtCache() {
  artRefresh.running = true;
  var lists = [];
  var answered = 0;
  var startedAt = Date.now();
  var failures = 0;
  var written = 0;

  function finish(result) {
    artRefresh.running = false;
    artRefresh.lastAt = Date.now();
    artRefresh.lastResult = result;
    note('art cache: ' + result + ' (' + Math.round((Date.now() - startedAt) / 100) / 10 + ' s)');
  }

  function listStep(i) {
    if (stopped) return finish('stopped');
    if (i >= ART_LIST_SOURCES.length) {
      if (!answered) return finish('no list answered');
      saveArtList(mergeArtLists(lists));
      return thumbStep();
    }
    var source = ART_LIST_SOURCES[i];
    artCall(source.request, source.params, ART_CALL_MS, function (error, reply) {
      if (error) {
        // The first one unanswered: Art Mode has ended or the service is not taking requests.
        if (!answered) return finish('list not answered: ' + error.message);
      } else {
        answered++;
        lists.push(contentItems(reply, source.params && source.params.category));
      }
      listStep(i + 1);
    });
  }

  function thumbStep() {
    if (stopped) return finish('stopped');
    var missing = artCache.items
      .filter(function (item) {
        return !hasThumb(item.id) && !item.noThumb;
      })
      .map(function (item) {
        return item.id;
      });
    if (!missing.length) return finish(artCache.items.length + ' pictures, ' + written + ' new thumbnails');
    if (failures >= 2 || state.art !== 'on') return finish('thumbnails stopped after ' + written + ': ' + (failures >= 2 ? 'two failures' : 'Art Mode ' + state.art));
    var batch = missing.slice(0, artRefresh.singleThumbs ? 1 : THUMB_BATCH);
    fetchThumbs(batch, function (error, count) {
      written += count;
      if (error) {
        failures++;
        note('art cache: thumbnails ' + batch.join(',') + ': ' + error.message);
        var refused = /: error /.test(error.message);
        if (refused && !artRefresh.singleThumbs) {
          // The list request refused outright (not a time-out): this TV may want one at a time.
          artRefresh.singleThumbs = true;
        } else if (refused) {
          // Refused one by one as well: skip that picture this run and go on with the others.
          var item = itemById(batch[0]);
          if (item) item.noThumb = true;
        }
      } else {
        failures = 0;
      }
      thumbStep();
    });
  }

  listStep(0);
}

/** Ask the TV to stream thumbnails for `ids` over a separate socket and write each one. */
function fetchThumbs(ids, done) {
  var single = artRefresh.singleThumbs;
  var params = {
    conn_info: { d2d_mode: 'socket', connection_id: Math.floor(Math.random() * 4294967295), id: crypto.randomBytes(16).toString('hex') },
  };
  if (single) params.content_id = ids[0];
  else
    params.content_id_list = ids.map(function (id) {
      return { content_id: id };
    });
  artCall(
    single ? 'get_thumbnail' : 'get_thumbnail_list',
    params,
    ART_CALL_MS,
    function (error, reply) {
      if (error) return done(error, 0);
      var info = reply.conn_info;
      if (typeof info === 'string') {
        try {
          info = JSON.parse(info);
        } catch (e) {
          return done(new Error('unreadable conn_info'), 0);
        }
      }
      if (!info || !info.port) return done(new Error('no port in conn_info'), 0);
      var count = 0;
      readThumbSocket(
        info,
        function (header, data) {
          // A single thumbnail's header may leave the id off: it is the one asked for.
          var id = header.fileID || header.content_id || (single ? ids[0] : null);
          if (saveThumb(id, header.fileType, data)) count++;
        },
        function (socketError) {
          done(socketError, count);
        }
      );
    },
    'conn_info'
  );
}

/**
 * Read a thumbnail stream. Its format, as the samsungtvws family of clients reads it: for each
 * image a 4-byte big-endian header length, a JSON header (`num`, `total`, `fileLength`, `fileID`,
 * `fileType`), then `fileLength` bytes of image. Throws on a header that cannot be right.
 */
function createThumbReader(onFile) {
  var pending = Buffer.alloc(0);
  var header = null;
  var count = 0;
  var total = null;
  return {
    feed: function (chunk) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      for (;;) {
        if (total !== null && count >= total) return;
        if (!header) {
          if (pending.length < 4) return;
          var length = pending.readUInt32BE(0);
          if (length < 2 || length > 65536) throw new Error('bad thumbnail header length ' + length);
          if (pending.length < 4 + length) return;
          var parsed = JSON.parse(pending.slice(4, 4 + length).toString('utf8'));
          var size = Number(parsed && parsed.fileLength);
          if (!(size >= 0) || size > THUMB_MAX_BYTES) throw new Error('bad thumbnail size ' + (parsed && parsed.fileLength));
          parsed.fileLength = size;
          header = parsed;
          pending = pending.slice(4 + length);
        }
        if (pending.length < header.fileLength) return;
        var data = Buffer.from(pending.slice(0, header.fileLength));
        pending = pending.slice(header.fileLength);
        var t = Number(header.total);
        if (t > 0) total = t;
        count++;
        var complete = header;
        header = null;
        onFile(complete, data);
      }
    },
    count: function () {
      return count;
    },
    complete: function () {
      return total !== null && count >= total;
    },
  };
}

function readThumbSocket(info, onFile, done) {
  var finished = false;
  function finish(error) {
    if (finished) return;
    finished = true;
    done(error || null);
  }
  var port = Number(info.port);
  var secured = info.secured === true || info.secured === 'true';
  function attempt(host, fallback) {
    var reader = createThumbReader(onFile);
    var gotData = false;
    var movedOn = false;
    var socket;
    try {
      socket = secured ? tls.connect({ host: host, port: port, rejectUnauthorized: false }) : net.connect({ host: host, port: port });
    } catch (e) {
      return finish(e);
    }
    socket.setTimeout(THUMB_SOCKET_MS, function () {
      socket.destroy(new Error('thumbnail socket quiet'));
    });
    socket.on('data', function (chunk) {
      gotData = true;
      try {
        reader.feed(chunk);
      } catch (e) {
        socket.destroy();
        return finish(e);
      }
      if (reader.complete()) {
        socket.destroy();
        finish(null);
      }
    });
    socket.on('error', function (e) {
      if (movedOn) return;
      // The TV may name its own network address; from inside the TV, 127.0.0.1 is the same host.
      if (!gotData && fallback) {
        movedOn = true;
        socket.destroy();
        return attempt(fallback, null);
      }
      finish(e);
    });
    socket.on('close', function () {
      if (movedOn) return;
      if (reader.complete() || reader.count() > 0) finish(null);
      else finish(new Error('thumbnail socket closed before any image'));
    });
  }
  var host = info.ip || '127.0.0.1';
  attempt(host, host === '127.0.0.1' ? null : '127.0.0.1');
}

// ---- The one change the launcher may ask for: show this picture ----

function choiceExpired(waiting, now) {
  return !waiting || !(now - Number(waiting.at) < CHOICE_TTL_MS);
}

function saveChoice() {
  if (!artCache.dir) return;
  var file = path.join(artCache.dir, 'choice.json');
  try {
    if (choice) writeWhole(file, JSON.stringify(choice));
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {
    // The choice still waits in memory.
  }
}

function dropExpiredChoice() {
  if (choice && choiceExpired(choice, Date.now())) {
    note('art: dropped the choice of ' + choice.id + ', not sent within ' + Math.round(CHOICE_TTL_MS / 1000) + ' s');
    choice = null;
    saveChoice();
  }
}

/** Queue a picture to show; it is sent the next time the art service answers in Art Mode. */
function queueChoice(id) {
  var item = itemById(id);
  choice = { id: id, category: item ? item.category : null, at: Date.now() };
  saveChoice();
  note('art: ' + id + ' chosen, waiting for Art Mode');
  // If Art Mode is already on, this sends it within a moment.
  askArtSoon(0);
}

function flushChoice() {
  dropExpiredChoice();
  if (!choice || ART_USE !== 'ask') return;
  var sending = choice;
  // Forgotten before the answer: select_image is sent once, never repeated.
  choice = null;
  saveChoice();
  var record = { id: sending.id, sentAt: new Date().toISOString(), answer: 'sent' };
  lastChoice = record;
  note('art: select_image ' + sending.id);
  artCall('select_image', { content_id: sending.id, category_id: sending.category || null, show: true }, ART_CALL_MS, function (error, reply) {
    if (error && /could not send|not open/.test(error.message)) {
      // It never left: keep it for the next answer.
      if (!choice) choice = sending;
      saveChoice();
      record.answer = 'not sent: ' + error.message;
      return;
    }
    // The TV may not answer select_image at all; a time-out here is not a failure.
    record.answer = error ? error.message : String((reply && reply.event) || 'answered');
    note('art: select_image ' + sending.id + ': ' + record.answer);
  });
}

function artSummary() {
  return {
    store: artCache.dir ? 'disk' : 'memory',
    dir: artCache.dir,
    pictures: artCache.items.length,
    thumbnails: artCache.dir ? Object.keys(artCache.thumbs).length : artCache.memoryOrder.length,
    updatedAt: artCache.updatedAt ? new Date(artCache.updatedAt).toISOString() : null,
    refreshing: artRefresh.running,
    lastRefresh: artRefresh.lastResult,
    choice: choice ? { id: choice.id, ageMs: Date.now() - choice.at } : null,
    lastChoice: lastChoice,
  };
}

/** GET /art/list: the cached pictures for the launcher, and what the cache is doing. */
function artListBody() {
  dropExpiredChoice();
  var body = artSummary();
  body.items = artCache.items.map(function (item) {
    return { id: item.id, kind: item.kind, thumb: hasThumb(item.id) };
  });
  return body;
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
    artCache: artSummary(),
    log: log,
  };
}

/** The id in /art/thumb/<id> or /art/choose?id=<id>, or null when it is not a content id. */
function idFromUrl(url, prefix) {
  var raw = url.slice(prefix.length).split('&')[0].split('#')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
    return null;
  }
  return ART_ID.test(raw) ? raw : null;
}

/** The Choose art screen's routes. True when the request was one of them. */
function artRoute(request, response, headers) {
  var url = request.url || '';
  if (url === '/art/list' || url.indexOf('/art/list?') === 0) {
    response.writeHead(200, headers);
    response.end(JSON.stringify(artListBody()));
    return true;
  }
  if (url.indexOf('/art/thumb/') === 0) {
    var id = idFromUrl(url, '/art/thumb/');
    var send = function (thumb) {
      if (!thumb) {
        response.writeHead(404, headers);
        response.end('{"error":"no thumbnail"}');
        return;
      }
      // A content id's picture does not change, so the page may keep it.
      response.writeHead(200, { 'Content-Type': thumb.type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400', 'Content-Length': thumb.data.length });
      response.end(thumb.data);
    };
    if (!id) send(null);
    else readThumb(id, send);
    return true;
  }
  if (url.indexOf('/art/choose') === 0) {
    var chosen = url.indexOf('/art/choose?id=') === 0 ? idFromUrl(url, '/art/choose?id=') : null;
    if (!chosen) {
      response.writeHead(400, headers);
      response.end('{"error":"no valid id"}');
    } else if (!itemById(chosen)) {
      response.writeHead(404, headers);
      response.end('{"error":"not a listed picture"}');
    } else {
      queueChoice(chosen);
      response.writeHead(200, headers);
      response.end(JSON.stringify({ ok: true, queued: chosen, expiresInMs: CHOICE_TTL_MS }));
    }
    // Anything sent with it is not needed.
    request.resume();
    return true;
  }
  return false;
}

var server = null;
function startStatusServer() {
  try {
    server = http.createServer(function (request, response) {
      var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
      if (artRoute(request, response, headers)) return;
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
    return { availableMB: available, freeMB: mb(os.freemem()), totalMB: mb(os.totalmem()), keeperMB: mb(process.memoryUsage().rss) };
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
  loadArtCache();
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
  failArtCalls('keeper stopped');
  if (probe && probe.temp) probe.temp.close();
  if (server) server.close();
};
module.exports.onExit = module.exports.onStop;

// For the unit tests on a computer; the TV only calls the three functions above.
module.exports._forTests = {
  artRequestAllowed: artRequestAllowed,
  sendArtRequest: sendArtRequest,
  createThumbReader: createThumbReader,
  choiceExpired: choiceExpired,
  CHOICE_TTL_MS: CHOICE_TTL_MS,
  /** The status page's port once it listens (tests pass port 0 to get a free one). */
  statusPort: function () {
    var address = server && server.address();
    return address && typeof address === 'object' ? address.port : null;
  },
};
