// Frame Home keeper: a background service in the launcher's own package.
//
// What it is for (all measured on the TV, docs/phase0-findings.md):
// - It is the launcher's second line. The launcher brings itself back when it sees Samsung's
//   home in front. If the launcher's page has been stopped, nobody is watching; this service
//   then opens the launcher when the TV announces on its own art channel that Art Mode has
//   ended (`art_mode_changed`, status `off`).
// - It reaches the art channel from inside the TV, with no pairing token. That is the road
//   for art controls in the launcher later.
// It cannot see which app is in front (Samsung's call returns nothing here), so the launcher
// gets a few seconds to come back by itself first.
//
// Its limit: after the power key puts the TV into Art Mode, the TV stops this service and the
// launcher within a minute, and starts neither again. So after a real Art Mode stay nothing
// of ours is running, and this service only helps after short ones.
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
// After Art Mode ends: a first look once the TV has had a moment to say it is going to sleep.
// If the launcher is not running at all, open it then. If it is running but hidden, it gets
// until the second look to come back by itself; it can see which app is in front and this
// service cannot.
var FIRST_LOOK_MS = process.env.FRAME_HOME_FIRST_LOOK_MS ? Number(process.env.FRAME_HOME_FIRST_LOOK_MS) : 1200;
var SECOND_LOOK_MS = process.env.FRAME_HOME_SECOND_LOOK_MS ? Number(process.env.FRAME_HOME_SECOND_LOOK_MS) : 4000;
var MIN_BETWEEN_LAUNCHES_MS = 5000;
var ART_ASK_EVERY_MS = process.env.FRAME_HOME_ART_ASK_MS ? Number(process.env.FRAME_HOME_ART_ASK_MS) : 5000;
var ART_RECONNECT_MS = 4000;
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
  lastLaunchAt: 0,
  launches: 0,
  launcherShownAt: 0,
  launcherSaid: 'nothing yet',
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
  if (!art || stopped) return;
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

/** True once Art Mode has been seen on; its end is what opens the launcher. */
var artWasOn = false;

function setArt(value, how) {
  if (state.art === value) return;
  state.art = value;
  note('art mode ' + value + ' (' + how + ')');
  if (value === 'on') artWasOn = true;
  else if (artWasOn && (value === 'off' || value === 'silent')) {
    artWasOn = false;
    planLaunch('Art Mode ended');
  }
}

function connectArt() {
  if (stopped) return;
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

// ---- Opening the launcher ----

var launchTimer = null;

/** Why the launcher must not be opened right now, or null when nothing speaks against it. */
function objection(plannedAt) {
  if (state.lastStandbyAt >= plannedAt - 3000) return 'the TV is going to sleep';
  // Asleep, the TV closes the art channel. In TV mode it stays open.
  if (!state.artConnected) return 'the art channel is closed, as when the TV sleeps';
  if (state.launcherShownAt >= plannedAt) return 'the launcher came back by itself';
  if (Date.now() - state.lastLaunchAt < MIN_BETWEEN_LAUNCHES_MS) return 'opened it a moment ago';
  if (state.art === 'on') return 'Art Mode is on again';
  return null;
}

function planLaunch(why) {
  if (launchTimer) clearTimeout(launchTimer);
  var plannedAt = Date.now();

  function look(last) {
    launchTimer = null;
    if (stopped) return;
    var against = objection(plannedAt);
    if (against) {
      note('not opening the launcher: ' + against);
      return;
    }
    readTv(function () {
      against = objection(plannedAt);
      if (!against && state.power !== 'on') against = 'TV power is ' + state.power;
      if (!against && state.launcher === 'on screen') against = 'it is on screen';
      if (against) {
        note('not opening the launcher: ' + against);
        return;
      }
      if (state.launcher === 'not running' || last) {
        openLauncher(why + ', launcher ' + state.launcher);
        return;
      }
      launchTimer = setTimeout(function () {
        look(true);
      }, Math.max(0, SECOND_LOOK_MS - FIRST_LOOK_MS));
    });
  }

  launchTimer = setTimeout(function () {
    look(false);
  }, FIRST_LOOK_MS);
}

function openLauncher(why) {
  state.lastLaunchAt = Date.now();
  state.launches++;
  note('opening the launcher: ' + why);
  function opened() {
    note('launcher opened');
  }
  function failed(e) {
    note('launcher did not open: ' + (e && e.message));
  }
  try {
    tizen.application.launch(LAUNCHER, opened, failed);
  } catch (e) {
    note('launcher did not open: ' + (e && e.message));
  }
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
      // The launcher says when it goes on and off screen: /launcher?state=visible or hidden.
      if (request.url && request.url.indexOf('/launcher') === 0) {
        state.launcherSaid = request.url.indexOf('state=visible') > 0 ? 'visible' : 'hidden';
        if (state.launcherSaid === 'visible') state.launcherShownAt = Date.now();
        response.writeHead(200, headers);
        response.end('{"ok":true}');
        return;
      }
      // The launcher asks before it comes back after Art Mode: has the TV just said it is
      // going to sleep? Only that notice counts; nothing here is inferred.
      if (request.url && request.url.indexOf('/sleep') === 0) {
        var age = state.lastStandbyAt ? Date.now() - state.lastStandbyAt : null;
        response.writeHead(200, headers);
        response.end(JSON.stringify({ sleepNoticeAgeMs: age }));
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
    beat();
    beatTimer = setInterval(beat, BEAT_MS);
  }
};

module.exports.onRequest = function () {
  note('keeper asked again: ' + startedBy());
};

module.exports.onStop = function () {
  note('keeper told to stop');
  stopped = true;
  if (beatTimer) clearInterval(beatTimer);
  if (launchTimer) clearTimeout(launchTimer);
  if (art) art.close();
  if (server) server.close();
};
module.exports.onExit = module.exports.onStop;
