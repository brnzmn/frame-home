/* Frame Probe. Runs on the TV and records what this TV lets a sideloaded app do.
   Results are shown on screen, kept in window.__report, and posted to the Mac.
   It never reads the TV's device id or network addresses. */
(function () {
  'use strict';

  var CFG = window.PROBE_CONFIG || {};
  var report = {
    version: 1,
    startedAt: new Date().toISOString(),
    checks: {},
    events: [],
    heartbeats: { total: 0, whileHidden: 0 }
  };
  window.__report = report;

  var ownId = null;
  var apps = [];
  var selected = 0;
  var openedId = null;        // the app we opened ourselves
  var openedSeen = false;     // it has shown up in the running list at least once
  var comeBackArmed = false;  // one shot: bring ourselves forward after being hidden
  var returnArmed = false;    // bring ourselves forward when the app we opened closes

  function $(id) { return document.getElementById(id); }
  function clock() { return new Date().toISOString().slice(11, 23); }
  function msg(e) { return String((e && (e.message || e.name)) || e); }

  function post(path, body) {
    if (!CFG.server) return;
    try {
      fetch(CFG.server + path, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) { /* the Mac being unreachable is fine */ }
  }

  function event(type, data) {
    var e = { t: clock(), type: type, data: data === undefined ? null : data, visible: document.visibilityState };
    report.events.push(e);
    if (report.events.length > 400) report.events.shift();
    renderEvents();
    post('/event', e);
  }

  function setCheck(name, status, detail) {
    report.checks[name] = { status: status, detail: detail === undefined ? null : detail };
    renderChecks();
  }

  function sendReport() { post('/report', report); }

  /* ---------- rendering ---------- */

  function renderChecks() {
    var ul = $('checks');
    if (!ul) return;
    ul.innerHTML = '';
    Object.keys(report.checks).forEach(function (k) {
      var c = report.checks[k];
      var li = document.createElement('li');
      var d = c.detail == null ? '' : (typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail));
      li.className = 'check ' + c.status;
      li.textContent = k + ': ' + c.status + (d ? '  ' + d.slice(0, 140) : '');
      ul.appendChild(li);
    });
  }

  function renderEvents() {
    var ul = $('events');
    if (!ul) return;
    ul.innerHTML = '';
    report.events.slice(-24).forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e.t + ' ' + e.type + (e.data == null ? '' : ' ' + JSON.stringify(e.data).slice(0, 80));
      ul.appendChild(li);
    });
  }

  function renderApps() {
    var ul = $('apps');
    if (!ul) return;
    ul.innerHTML = '';
    var first = Math.max(0, Math.min(selected - 10, apps.length - 22));
    apps.slice(first, first + 22).forEach(function (a, i) {
      var li = document.createElement('li');
      if (first + i === selected) li.className = 'selected';
      li.textContent = (a.show ? '' : '(hidden) ') + a.name + '   ' + a.id;
      ul.appendChild(li);
    });
  }

  /* ---------- checks ---------- */

  function checkEnv() {
    var d = {
      userAgent: navigator.userAgent,
      inner: [window.innerWidth, window.innerHeight],
      screen: [screen.width, screen.height],
      dpr: window.devicePixelRatio
    };
    var m = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
    d.chromium = m ? Number(m[1]) : null;
    try { d.platformVersion = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version'); } catch (e) { d.platformVersionError = msg(e); }
    try {
      d.model = webapis.productinfo.getModel();
      d.realModel = webapis.productinfo.getRealModel();
      d.firmware = webapis.productinfo.getFirmware();
    } catch (e) { d.productInfoError = msg(e); }
    try {
      ownId = tizen.application.getCurrentApplication().appInfo.id;
      d.ownId = ownId;
    } catch (e) { d.ownIdError = msg(e); }
    setCheck('env', typeof window.tizen === 'undefined' ? 'fail' : 'ok', d);
  }

  function looksLikeFrameFeature(a) {
    var re = /(^|[^a-z])art([^a-z]|$)|ambient|frame|gallery/i;
    return re.test(a.id) || re.test(a.name);
  }

  function checkApps() {
    try {
      tizen.application.getAppsInfo(function (list) {
        var all = list.map(function (a) {
          return { id: a.id, name: a.name, show: a.show, iconPath: a.iconPath, packageId: a.packageId, version: a.version };
        });
        var shown = all.filter(function (a) { return a.show; });
        var frame = all.filter(looksLikeFrameFeature);
        report.apps = all;
        apps = frame.filter(function (a) { return !a.show; }).concat(shown);
        setCheck('apps.list', 'ok', { total: all.length, shown: shown.length });
        setCheck('apps.frame', frame.length ? 'ok' : 'none', frame.map(function (a) {
          return a.name + ' = ' + a.id + (a.show ? '' : ' (hidden)');
        }));
        renderApps();
        checkIcons(shown);
      }, function (e) { setCheck('apps.list', 'fail', msg(e)); });
    } catch (e) { setCheck('apps.list', 'fail', msg(e)); }
  }

  function checkIcons(list) {
    var ok = 0;
    var failed = [];
    var pending = list.length;
    if (!pending) { setCheck('apps.icons', 'none'); return; }
    list.forEach(function (a) {
      var img = new Image();
      function done(good) {
        if (good) ok++; else failed.push(a.name);
        if (--pending === 0) {
          setCheck('apps.icons', failed.length ? 'partial' : 'ok', { loaded: ok, failed: failed.length, failedNames: failed.slice(0, 20) });
        }
      }
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      img.src = a.iconPath && a.iconPath.charAt(0) === '/' ? 'file://' + a.iconPath : a.iconPath;
    });
  }

  function checkNet() {
    var t0 = Date.now();
    try {
      fetch('https://api.themoviedb.org/3/configuration')
        .then(function (r) { setCheck('net.tmdb', 'ok', { status: r.status, ms: Date.now() - t0 }); })
        .catch(function (e) { setCheck('net.tmdb', 'fail', msg(e)); });
    } catch (e) { setCheck('net.tmdb', 'fail', msg(e)); }
    if (!CFG.server) { setCheck('net.mac', 'skipped', 'no server configured'); return; }
    try {
      fetch(CFG.server + '/health')
        .then(function (r) { setCheck('net.mac', r.ok ? 'ok' : 'fail', { status: r.status }); })
        .catch(function (e) { setCheck('net.mac', 'fail', msg(e)); });
    } catch (e) { setCheck('net.mac', 'fail', msg(e)); }
  }

  /* Can this app reach the TV's own art controls, the ones the phone app uses over Wi-Fi? */
  function socketTest(name, url) {
    var settled = false;
    var t0 = Date.now();
    var ws;
    var timer = setTimeout(function () { done('timeout'); }, 7000);
    function done(status, detail) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setCheck(name, status, detail);
      try { ws.close(); } catch (e) { /* already closed */ }
    }
    try {
      ws = new WebSocket(url);
      ws.onmessage = function (m) {
        var ev = null;
        try { ev = JSON.parse(m.data).event; } catch (e) { /* not JSON */ }
        done('ok', { firstEvent: ev, ms: Date.now() - t0 });
      };
      ws.onerror = function () { done('fail', { ms: Date.now() - t0 }); };
      ws.onclose = function (c) { done('closed', { code: c.code, ms: Date.now() - t0 }); };
    } catch (e) { done('fail', msg(e)); }
  }

  function checkArtControls() {
    var name = btoa('Frame Probe');
    socketTest('art.local.8001', 'ws://127.0.0.1:8001/api/v2/channels/com.samsung.art-app?name=' + name);
    socketTest('art.local.8002', 'wss://127.0.0.1:8002/api/v2/channels/com.samsung.art-app?name=' + name);
  }

  function sourceName(s) { return s ? s.type + s.number : null; }

  function checkInputs() {
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (vs) {
        report.videoSources = { connected: vs.connected || [], disconnected: vs.disconnected || [] };
        setCheck('inputs.list', 'ok', {
          connected: report.videoSources.connected.map(sourceName),
          disconnected: report.videoSources.disconnected.map(sourceName)
        });
      }, function (e) { setCheck('inputs.list', 'fail', msg(e)); });
    } catch (e) { setCheck('inputs.list', 'fail', msg(e)); }
    try {
      tizen.tvwindow.getSource(
        function (s) { setCheck('inputs.current', 'ok', sourceName(s)); },
        function (e) { setCheck('inputs.current', 'fail', msg(e)); }
      );
    } catch (e) { setCheck('inputs.current', 'fail', msg(e)); }
  }

  /* On demand (key 2): show the first connected HDMI input inside the app for 8 seconds, then put things back. */
  function hdmiTest() {
    var src = report.videoSources && report.videoSources.connected.filter(function (s) { return s.type === 'HDMI'; })[0];
    if (!src) { setCheck('inputs.show', 'skipped', 'no connected HDMI input'); return; }
    function fail(step) {
      return function (e) {
        document.body.classList.remove('hole');
        setCheck('inputs.show', 'fail', step + ': ' + msg(e));
      };
    }
    try {
      tizen.tvwindow.getSource(function (original) {
        tizen.tvwindow.setSource(src, function () {
          document.body.classList.add('hole');
          tizen.tvwindow.show(function (rect) {
            setCheck('inputs.show', 'ok', { source: sourceName(src), rect: rect });
            setTimeout(function () {
              tizen.tvwindow.hide(function () {
                document.body.classList.remove('hole');
                tizen.tvwindow.setSource(original, function () { event('inputs.restored', sourceName(original)); }, fail('restore'));
              }, fail('hide'));
            }, 8000);
          }, fail('show'), ['0px', '0px', '1920px', '1080px'], 'MAIN');
        }, fail('setSource'));
      }, fail('getSource'));
    } catch (e) { fail('exception')(e); }
  }

  /* On demand (key 3) and once at start: frame rate of a focus-style animation, plain, with shadows, with blur. */
  function fpsTest() {
    var stage = $('fps-stage');
    var modes = ['plain', 'shadow', 'blur'];
    var results = {};
    function run(i) {
      if (i >= modes.length) {
        stage.className = '';
        stage.innerHTML = '';
        setCheck('fps', 'ok', results);
        sendReport();
        return;
      }
      stage.className = 'on ' + modes[i];
      stage.innerHTML = '';
      for (var n = 0; n < 12; n++) {
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.style.animationDelay = (n * -0.15) + 's';
        stage.appendChild(tile);
      }
      var frames = 0;
      var worst = 0;
      var start = performance.now();
      var last = start;
      var finished = false;
      function finish(stalled) {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        var seconds = (performance.now() - start) / 1000;
        results[modes[i]] = { fps: Math.round(frames / seconds), worstFrameMs: Math.round(worst) };
        if (stalled) results[modes[i]].stalled = true;
        run(i + 1);
      }
      // Frames stop arriving while the app is hidden; never leave the test screen up.
      var watchdog = setTimeout(function () { finish(true); }, 5000);
      function tick(t) {
        if (finished) return;
        frames++;
        if (t - last > worst) worst = t - last;
        last = t;
        if (t - start < 3000) { requestAnimationFrame(tick); return; }
        finish(false);
      }
      requestAnimationFrame(tick);
    }
    run(0);
  }

  /* ---------- app switching ---------- */

  function runningApps(cb) {
    try {
      tizen.application.getAppsContext(
        function (ctxs) { cb(ctxs.map(function (c) { return c.appId; })); },
        function () { cb(null); }
      );
    } catch (e) { cb(null); }
  }

  function bringBack(why) {
    if (!ownId) { event('bringBack.skip', 'own id unknown'); return; }
    try {
      tizen.application.launch(ownId,
        function () { event('bringBack.ok', why); },
        function (e) { event('bringBack.fail', msg(e)); });
    } catch (e) { event('bringBack.fail', msg(e)); }
  }

  function openApp(id) {
    openedId = id;
    openedSeen = false;
    event('open', id);
    try {
      tizen.application.launch(id,
        function () { event('open.ok', id); },
        function (e) { openedId = null; event('open.fail', { id: id, error: msg(e) }); });
    } catch (e) { openedId = null; event('open.fail', { id: id, error: msg(e) }); }
  }

  function heartbeat() {
    var hidden = document.visibilityState === 'hidden';
    report.heartbeats.total++;
    if (hidden) report.heartbeats.whileHidden++;
    runningApps(function (ids) {
      post('/event', { t: clock(), type: 'heartbeat', visible: document.visibilityState, running: ids });
      if (!openedId || !ids) return;
      if (ids.indexOf(openedId) !== -1) { openedSeen = true; return; }
      if (!openedSeen) return;
      var was = openedId;
      openedId = null;
      event('openedAppClosed', was);
      if (returnArmed && hidden) bringBack('return after ' + was);
    });
  }

  function watchLifecycle() {
    document.addEventListener('visibilitychange', function () {
      event('visibility', document.visibilityState);
      if (document.visibilityState === 'hidden') {
        if (comeBackArmed) {
          comeBackArmed = false;
          setTimeout(function () { bringBack('come-back test'); }, 2000);
        }
      } else {
        sendReport();
      }
    });
    window.addEventListener('blur', function () { event('blur'); });
    window.addEventListener('focus', function () { event('focus'); });
    window.addEventListener('pagehide', function () { event('pagehide'); });
    window.addEventListener('pageshow', function () { event('pageshow'); });
    try {
      tizen.application.addAppStatusChangeListener(function () {
        event('appStatus', Array.prototype.slice.call(arguments));
      });
      setCheck('lifecycle.statusListener', 'ok');
    } catch (e) { setCheck('lifecycle.statusListener', 'fail', msg(e)); }
    setInterval(heartbeat, 3000);
  }

  /* ---------- remote keys ---------- */

  function setupKeys() {
    try {
      var supported = tizen.tvinputdevice.getSupportedKeys();
      var names = supported.map(function (k) { return k.name; });
      report.supportedKeys = supported.map(function (k) { return k.name + '=' + k.code; });
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (n) {
        if (names.indexOf(n) === -1) return;
        try { tizen.tvinputdevice.registerKey(n); } catch (e) { /* key stays unregistered */ }
      });
      setCheck('keys', 'ok', {
        supported: supported.length,
        homeLike: names.filter(function (n) { return /home|menu|power|source|exit/i.test(n); })
      });
    } catch (e) { setCheck('keys', 'fail', msg(e)); }
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    event('key', { code: e.keyCode, key: e.key });
    switch (e.keyCode) {
      case 38: selected = Math.max(0, selected - 1); renderApps(); break;
      case 40: selected = Math.min(apps.length - 1, selected + 1); renderApps(); break;
      case 13: if (apps[selected]) openApp(apps[selected].id); break;
      case 49: comeBackArmed = true; event('armed', 'come-back test: press Home or open an app'); break;
      case 50: hdmiTest(); break;
      case 51: fpsTest(); break;
      case 52: sendReport(); event('report.sent'); break;
      case 53: returnArmed = !returnArmed; event('returnArmed', returnArmed); break;
      case 48: try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* not on a TV */ } break;
      default: break;
    }
  }

  /* ---------- start ---------- */

  function start() {
    $('status').textContent = 'running';
    checkEnv();
    watchLifecycle();
    setupKeys();
    checkApps();
    checkNet();
    checkInputs();
    checkArtControls();
    setTimeout(fpsTest, 4000);
    setTimeout(function () {
      sendReport();
      $('status').textContent = 'report sent ' + clock();
    }, 16000);
    event('started');
  }

  window.probe = {
    openApp: openApp,
    bringBack: bringBack,
    fpsTest: fpsTest,
    hdmiTest: hdmiTest,
    sendReport: sendReport,
    armComeBack: function () { comeBackArmed = true; },
    armReturn: function (on) { returnArmed = !!on; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
