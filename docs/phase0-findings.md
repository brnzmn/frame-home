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

### Art controls: working, but only while Art Mode is on

- Pairing works. The art channel opens and reports ready, from the Mac and from inside the TV app.
- On the home screen every request goes unanswered. With the Art app in front (Art Mode on) the service answers from the Mac over port 8002 with the pairing token. Art API version `5.0.1.0`.
- The `samsungframetv` classes fail on this TV: the TV sends art events before the channel's own connect frame, which the library treats as a failed connection. `tools/frame/artws.py` is our own small client and works.
- Answered: `api_version`, `get_artmode_status`, `get_matte_list`, `get_current_artwork`, `get_device_info`, `get_artmode_settings`, `get_photo_filter_list`, `get_slideshow_status`, `get_content_list`, `change_matte`.
- Mat styles: none, modernthin, modern, modernwide, flexible, shadowbox, panoramic, triptych, mix, squares. Colours: black, neutral, antique, warm, polar, sand, seafoam, sage, burgandy, navy, apricot, byzantine, lavender, redorange, skyblue, turquoise. Filters: None, Aqua, ArtDeco, Ink, Wash, Pastel, Feuve.
- **Changing a mat works.** `change_matte` on the artwork on screen (an Art Store stream image) was acknowledged, the TV sent `matte_changed`, and its content list and slideshow list both showed the new mat. The original was put back and confirmed the same way.
- Two traps:
  - `get_current_artwork` keeps returning the old mat after a change. Verify against `get_slideshow_status` or `get_content_list`.
  - Sending only `matte_id` also rewrites `portrait_matte_id` (to the same mat, or to `shadowbox_black` when the mat is `none`). Always send both.
- Baran's art is an Art Store stream: a slideshow of 30 images changing every 5 minutes. All 30 have landscape mat `none`; their portrait mats differ (shadowbox polar 7, shadowbox antique 11, none 8, flexible neutral 3, flexible polar 1). `get_content_list` with no category returned one item, so the slideshow list is the inventory to work from.
- From inside the TV app the channel opens on port 8001, but requests there got no reply even with the Art app in front. Whether passing the pairing token on 8001 fixes that is untested, so for now the frame look runs from the Mac.
- Not yet known: which of the two mat fields draws the band Baran sees on his landscape TV. A live preview with him watching settles it.

### Gate: passed on 2026-11-10

- **Survives a power cycle:** after Baran's full power cycle the probe was still in the TV's installed-app list and opened normally. Developer Mode, its Host PC IP and the developer connection survived too.
- **Lists and opens apps:** confirmed above.
- **A way back in without hunting:** return after an app closes is confirmed. The TV still opens Samsung's home at power-on, as expected; the SmartThings rule is the fix and is not set up yet.

### Not tested yet

- The SmartThings power-on rule, and that it leaves Art Mode alone.
- An HDMI input shown inside the app, with a live source connected.
- How long a hidden app keeps running beyond two minutes.
- Home pressed from inside another app (the running-apps list may reveal it).
