# Phase 0 findings

What has actually been observed on the TV. Anything not listed as confirmed is still unverified.
Raw evidence: `docs/probe-report.json` (the probe's own report) and `docs/private/` (event log, screenshots, art diagnostics; not committed).

## 2026-11-10

### Confirmed on the TV

**Getting an app onto it**
- The TV's info page reports model `TQ65LS03FWUXXC` (`25_RSM_FTV`), Tizen, Frame support, wireless.
- Developer Mode switches on with the 12345 code. The TV accepts the developer connection only from the Host PC IP stored in it, after a restart.
- `sdb` reports `platform_version:9.0`, `cpu_arch:armv7`, `sdbd_version:2.2.31`.
- Tizen Studio 6.1 tools and Certificate Manager run under Rosetta on macOS 27. Certificate Manager's wizard ignores background clicks; Baran clicked it through. Profile: `framehome`.
- A package signed with that profile installs and runs. A `.wgt` file name containing a space fails with "Failed to install Tizen application" and an empty log.

**Inside the app**
- Tizen 9.0, Chromium 120, 1920x1080 at device pixel ratio 1, firmware `T-RSMFDEUC-0090-1301.0`.
- The debug port speaks the Chrome DevTools Protocol: evaluating code works, and screenshots work while the app is on screen. A screenshot request while the app was hidden coincided with the app going silent, so do not take one while hidden.
- The app list returns 526 entries, 244 flagged as shown, most of them system parts. The launcher needs its own curated list.
- App ids: Netflix `org.tizen.netflix-app`, Prime Video `org.tizen.primevideo`, YouTube `9Ur5IzDKqV.TizenYouTube`, Disney+ `MCmYXNxgcu.DisneyPlus`, Apple TV `com.samsung.tv.aria-video`, Spotify `rJeHak5zRg.Spotify`, Internet `org.tizen.browser`, Art `org.tizen.art-app`, Gaming Hub `com.samsung.tv.gaminghub`, SmartThings `com.samsung.tv.SmartThingsApp`.
- Icons load for 85 of the 244 shown entries. Prime Video's does not, so tiles need fallback artwork.
- Opening apps works (Internet, Art).
- TMDB is reachable from the app, and the app can post to the Mac.
- 46 remote keys can be registered, including Source, Menu and Exit. Home is not among them.

**Behaviour that decides the launcher**
- The app keeps running while hidden: heartbeats continued for two minutes behind the Art app. Longer is untested.
- A hidden app can bring itself back to the front by launching its own id. It arrives as a fresh page load, so state has to be saved and restored.
- Return after close works: one second after the Internet app was closed, the probe was back in front. It noticed through the running-apps list.
- Home button: about 0.7 seconds after Home the app gets `blur` and then `visibilitychange: hidden`, and `com.samsung.tv.home.art` and `com.samsung.tv.homeupdateview` appear in the running-apps list. With the come-back armed, the probe returned in front of Samsung's home and stayed there (3.3 seconds, of which 2 were a test delay).
- `addAppStatusChangeListener` registers but never fired.

**Performance**
- Focus-style animation: 59 fps with plain transforms, 55 fps with large shadows, 31 fps with a large live backdrop blur. No live blur in the launcher.

**Inputs**
- The TV lists `TV1` as connected and `HDMI1` to `HDMI4` as disconnected. Nothing was plugged in, so showing an HDMI input inside the app is untested.
- `tizen.tvwindow.getSource` is synchronous; the probe called it with callbacks and failed.

### Art controls: not working yet

- Pairing works. The art channel opens and reports ready, from the Mac and from inside the TV app.
- Requests get no reply: `api_version`, `get_artmode_status`, `get_matte_list`, `get_current_artwork`, the image list, the settings. Tested on the home screen and with the Art app in front, with `tools/frame/check.py`, the library's own diagnostic, and a socket opened from inside the app.
- With the Art app in front the service does broadcast events: `image_selected` (including `matte_id`), `slideshow_image_changed`, `notify.sync_server`.
- So the global mat is unproven. The service is alive, but ignores requests in the format the library sends.

### Not tested yet

- Whether the installed app survives a full power cycle.
- The SmartThings power-on rule, and that it leaves Art Mode alone.
- An HDMI input shown inside the app, with a live source connected.
- How long a hidden app keeps running beyond two minutes.
- Home pressed from inside another app (the running-apps list may reveal it).
