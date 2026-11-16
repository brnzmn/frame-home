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
- **A mat change cannot always be undone.** `change_matte` answers error -7 when the TV refuses a mat for an image. It refused `modernthin_black` on one image, and it refused every attempt to set a portrait mat to `none` (upper or lower case, with or without the landscape mat). A change-and-restore test on `SAM-S1111996` therefore left that image's portrait mat at `shadowbox_black` where it had been `none`. Its landscape mat is unchanged. Whether that shows on the landscape-mounted TV is unknown. The write test has been removed, and `apply_look.py` only replaces a mat an image already has.
- Later the same evening the slideshow reported `off`, with one fixed artwork (`SAM-S1111996`, category `ARTSTREAM`) and only two images listed. Between the two readings Baran power-cycled the TV and opened the art selector; the cause is not established.
- Guess, not verified: the two mat fields describe the artwork's shape, not how the TV hangs. In the stream every landscape mat was `none` while the portrait mats varied, which would match bands that differ from image to image.
- Art settings recorded in `docs/art-settings-snapshot.json`: brightness 0 of 10, colour tone 0, motion sensitivity 2, motion timer off, brightness sensor on.
- With the TV asleep (`PowerState: standby`, screen off) the art channel does not open at all.
- From inside the TV app the channel opens on port 8001, but requests there got no reply even with the Art app in front. Whether passing the pairing token on 8001 fixes that is untested, so for now the frame look runs from the Mac.
- Not yet known: which of the two mat fields draws the band Baran sees on his landscape TV. A live preview with him watching settles it.

### Gate: passed on 2026-11-10

- **Survives a power cycle:** after Baran's full power cycle the probe was still in the TV's installed-app list and opened normally. Developer Mode, its Host PC IP and the developer connection survived too.
- **Lists and opens apps:** confirmed above.
- **A way back in without hunting:** return after an app closes is confirmed. The TV still opens Samsung's home at power-on, as expected; the SmartThings rule is the fix and is not set up yet.

### Launcher on the TV (2026-11-10)

- Frame Home 0.1.0 (`FrameHome1.FrameHome`) is installed and runs: three Frame cards and thirteen app tiles in rows of six. Screenshot taken from the TV: `docs/design/tv-second-install.png`.
- Every icon the TV ships is square, 117 to 512 px. Reading an icon's pixels from a canvas is allowed, so the launcher measures each one. Icons with a flat background are sized to their logo and their colour continues across the tile; icons with a gradient cover the tile; rounded placeholders with transparent corners (YouTube, SmartThings, Workspace) are dropped for the launcher's own artwork. Prime Video and Internet have no loadable icon.
- The app list's `show` flag separates real apps from the background services that also carry store-style ids.
- The test app, Frame Probe, has been uninstalled. Further checks run through the launcher's debug port.
- Frame card targets, tested from the launcher by watching whether it loses the screen or the focus:
  - `org.tizen.menu` (the TV's settings; its metadata lists `tvSettings.OpenSettings`) and `com.samsung.tv.quickpanel` open as overlays: the launcher stays visible and loses focus.
  - `com.samsung.tv.home.art`, Samsung's art picker, fails with `UnknownError`. Baran saw "Could not open Choose art".
  - `com.samsung.tv.coba.setting`, `org.tizen.homesetting`, `com.samsung.tv.wizard.art`, `com.samsung.tv.coba.art`, `com.samsung.tv.floating-menu`, `com.samsung.tv.ambient-support` and `org.tizen.SMSourceAPP` launch without error and show nothing.
  - No way was found for an app to open Samsung's art picker. A "Choose art" screen would have to be our own, built on the art controls.
- Confirmed by Baran on the TV: Settings opens the normal settings menu; Quick settings opens a violet panel he had not seen before and likes; Art Mode opens Art Mode, and pressing OK there opens Samsung's art selector.
- Still to confirm: that the launcher build returns after an app closes, as the probe did; how to get back to the launcher from Art Mode; and how the colours look on the panel. In Baran's photos the probe's near-black page looked bright blue.

### Home button: jump back, measured 2026-11-11

Baran chose our own jump-back over changing the TV's "home app" setting. Timings below are the launcher's own record on the TV (`frame-home.trace` in its storage), not the Mac's clock.

- `webapis.appcommon.getForegroundAppId()` works with our certificate and says which app is on screen. `webapis.js` is loaded at run time from `$WEBAPIS/webapis/webapis.js`.
- Samsung's home in front reports `com.samsung.tv.csfs`, already at the moment the launcher goes hidden.
- Art Mode reports `org.tizen.art-app`. On the way in there is a moment where the call throws "AppID is null" and the page still says visible.
- **Single Home press:** hidden, decision 18 ms later, launcher running again 0.44 s after going hidden. Slowest run 1.6 s.
- **Second Home press within six seconds:** Samsung's home is left up. Confirmed: still up twelve seconds later.
- **Art Mode:** the launcher stayed hidden for 45 seconds while the Mac confirmed the art service was answering. It never pulled the TV out of art.
- **Leaving Art Mode** (power key): the TV shows Samsung's home, the launcher sees it and is back 2.7 seconds later. This was after only 12 seconds of Art Mode. It does not hold for a normal stay; see the next section.
- A hidden page's timers run once a second, which made the first version take 3 to 4 seconds. Acting at the moment of going hidden fixed that. The worker-driven tick reads the foreground every 250 ms.
- Pressing Home within about half a second of the launcher restarting is swallowed by the TV.
- The public app-status page (`/api/v2/applications/<id>`) lags by several seconds around switches. Do not time anything with it.
- Unknown: how long the launcher survives in the background over hours of another app. If the TV stops it, Home shows Samsung's home until the launcher is opened again.

### Art Mode stops our apps (2026-11-11, evening)

Every run below used the power key from the Mac (`tools/frame/key.py KEY_POWER`), which is what the remote's power button does. Evidence: the launcher's own record, the keeper's reports to the Mac (`tools/deploy.mjs --report` with `tools/probe-server.mjs`), and the TV's public app-status page.

**Result: after a real Art Mode stay, power-on shows Samsung's home and the launcher is not running. Nothing we can do inside the app changes that in normal use.**

**The problem**
- After the power key puts the TV into Art Mode, it stops the hidden launcher, between 5 and 47 seconds in. Leaving Art Mode then shows Samsung's home with the launcher not running. The earlier "45 seconds in Art Mode" check only showed that the launcher did not interfere, not that it was still alive.
- This is specific to the power key. Behind the Art app opened as an app (2026-11-10) the probe kept running for two minutes, and behind YouTube the launcher survived two minutes and returned by itself.
- A background service in the same package (`<tizen:service>`, started with the `operation/service` app control) is stopped the same way. `on-boot="true"` and `auto-restart="true"` did not bring it back within a minute of leaving Art Mode, and the `prelaunch.support` metadata had no visible effect either.
- The TV's status page says `PowerState: on` in TV mode and for at least the first five minutes of Art Mode, so it does not tell the two apart. (`standby` was read on 2026-11-10; when it switches is unknown.)

**What the TV offers a service**
- The service runs on Node 18.18.2 with `tizen` available. `webapis` exists there but `getForegroundAppId()` returns nothing, so only the launcher's page can tell which app is in front.
- The service reaches the art channel at `ws://127.0.0.1:8001/api/v2/channels/com.samsung.art-app` with no pairing token. Requests go `to: "host"`. In TV mode `get_artmode_status` was sometimes answered `off` and sometimes not answered.
- The TV announces Art Mode on that channel: `art_mode_changed` with status `on` about a second after the power key, and status `off` between 1 and 6 seconds after the power key on the way out.
- The service keeps running when the launcher quits.

**Alarms: tried, and not the answer**
- `tizen.alarm` (privilege `alarm`) only accepts an alarm for the launcher's id. For the service's id the TV answers "Error while add alarm to server". The service may set one for the launcher's id.
- **An alarm that fires opens the launcher and ends Art Mode.** Confirmed with a 55-second alarm. So an alarm cannot be used to start anything during Art Mode.
- A pending alarm that carries a launch request, set seconds earlier, did keep launcher and service alive through Art Mode (52, 210, 120, 120, 150, 300 and 90 seconds), with it renewed every ten seconds in the later runs. Without an alarm, or with one that carries no launch request, they were stopped 10 runs out of 10.
- **But only for a launcher that had just been started from the Mac.** Same build, same alarm, one Home press before Art Mode: both stopped, twice out of two (and a third time after several Home presses and an app). A launcher started afresh by the service instead of from the Mac: stopped as well. In real use the launcher is always one of those, so the alarm was taken out again. Why a launch from the Mac is treated differently is not known.

**Coming back when Art Mode ends, while something of ours is still alive**
- The TV reports Samsung's home in front half a second after the power key, but ignores a request to open the launcher while it is still leaving Art Mode. One request took 6.7 seconds to land. The launcher now asks again every second until it is on screen, at most 15 times.
- A page that has been hidden for minutes cannot count on its own timers (one did not fire in 6.7 seconds). Only the worker-driven tick keeps time, at about one a second.
- With the launcher's page stopped and the service alive, the service opened the launcher 4 seconds after the TV's announcement; the launcher was on screen 8 seconds after the power key. **That fallback was taken out the same evening** after a second review: the service cannot see which app is in front, so it would also have opened the launcher over a console, a cast or anything else that takes the TV out of Art Mode. The service now opens nothing.
- With both alive after five minutes of Art Mode (alarm trick, launcher started from the Mac), the launcher was on screen 3.3 seconds after the power key.
- Untested, and guarded against rather than known: what the TV reports when it goes to sleep from Art Mode by itself. The launcher does not come back if the service heard a going-to-sleep notice in the last 20 seconds, and it checks again that Samsung's home is still in front after asking.
- From the Mac, the art channel stopped opening about two minutes after Art Mode was entered at 19:00 and again within 20 seconds at 19:07, while the status page still said `PowerState: on`. That matches the TV sleeping in a dark room, but nobody was looking at the screen, so it is not confirmed.

**Other things seen**
- `reload="disable"` on the launcher's app control: bringing the running launcher forward no longer loads the page again. Home once: back in 0.6 to 0.8 seconds. Home twice: Samsung's home stays. Before this, the reload also restarted the service.
- YouTube in front reports `com.samsung.tv.cobalt-yt`, not its store id. The first Exit press in YouTube opens YouTube's own exit question; the second closes it, and the launcher was back 0.75 seconds later.
- OK in Art Mode opens Samsung's art selector with Art Mode still on. Back from the selector ends Art Mode.

### PS5 dropping in and out (2026-11-16)

- Baran: the PS5 on HDMI 3 kept appearing and disappearing. With the Frame Home package uninstalled it was stable at once.
- Not the keeper: with its art questions switched off the PS5 still dropped, and with the launcher closed and only the keeper running it stayed (10+ minutes).
- The cause: the launcher on screen. When the PS5 wakes it asks the TV for the screen; the TV flashes black and comes back to the launcher, whose page never even goes hidden. The PS5 then drops off the TV's input list (`VIDEOSOURCE`), and the next PS press repeats it. Logged at 15:55, 16:12 and 16:13 local, `docs/private/hdmi-test-2026-11-16.log`.
- With Samsung's home in front, a waking PS5 only appears on that home and waits for a click, buried under Samsung's channels (Baran's main complaint about it).
- An HDMI input on screen reports `org.tizen.tv-viewer` in front (the game bar as `com.samsung.tv.gamebar`), not Samsung's home, so the jump-back leaves it alone (10+ minutes of play, no drop).
- `tizen.application.launch('org.tizen.tv-viewer')` from the launcher shows the current source full screen; `tizen.tvwindow.getSource('MAIN')` reads it.
- Fix, seen working on the TV: a PlayStation 5 tile opens HDMI 3 that way, and when an input switches on while the launcher is on screen, the launcher opens it. It reached the PS5 within a second of it waking (16:38:17); the TV's own black-flash attempt still comes first, so the round trip takes about 2 seconds.

### Lag between clicks (2026-11-16)

Measured on the TV with `tools/lag-test.mjs` (arrow keys over the debug port, the launcher's own record of keydown until the change can be on screen, and the frame rate in the 500 ms after each press):

| Build | Key to screen, median / p95 | Frames per second after a press | Worst frame gap |
|---|---|---|---|
| As built (0.1.0) | 27 / 215 ms | 5 | 433 ms |
| Colour washes hidden | 10 / 33 ms | 58 | 33 ms |
| Shadows off, washes on | 22 / 244 ms | 12 | 417 ms |
| Both off | 11 / 18 ms | 60 | 17 ms |
| Glow as pre-painted layers, only their opacity cross-faded | — / 233 ms stall | 22 | — |
| **Fixed (commit "Fast home"), glow off** | 12 / 19 ms | 60 | 17 ms |
| Trial look Gallery / Clean / Paper | 11 / 18, 14 / 18, 12 / 18 ms | 60 | 17 ms |

- The cause is the two full-screen `.wash` layers: radial gradients mixed from a colour that changes on every move, cross-faded over 480 ms. Every press repainted a full screen of gradient, and the TV stalled for about 430 ms each time. Shadows add a little on top.
- Even with one pre-painted layer per colour, changing which full-screen layer shows on a key press costs the same kind of stall. The glow is off; focus shadows are pre-painted and only fade.
- Our own code is not the cost: the key handler takes 0 to 1 ms.
- Start, before: the script runs at 345 ms after page start; the TV's app list arrives at 761 ms; tiles are drawn at 1040 ms. After (tiles from the cached app list): script 95, tiles drawn 336, app list 594 ms.

### Apple TV and Hue Sync stop the launcher (2026-11-16)

In Baran's run through every tile, Home brought the launcher back after every app except Apple TV and Hue Sync. Controlled runs (`deploy.mjs build/app --report --debug`, the app opened from the launcher, keeper heartbeats every 5 s with the TV's free memory; log `docs/private/kill-test-2026-11-16b.log`):

| App in front | Launcher stopped by the TV | Keeper | Free memory |
|---|---|---|---|
| Apple TV (`com.samsung.tv.aria-video`) | 33–38 s after it opened | kept running | 380–440 MB of 1.9 GB |
| Hue Sync (`kupCeIdDkX.HueSync`) | 63–68 s after it opened | kept running | 260–400 MB |
| Netflix | not within 100 s | kept running | 340–460 MB |

- It is not memory pressure: free memory did not drop before the stop. The cause is unknown.
- In Baran's own run the keeper also stopped answering about 20 s into Hue Sync and did not come back until the next install; in the controlled run it survived.
- With the launcher gone, Home shows Samsung's home and stays there; the launcher has to be opened from Samsung's apps row.
- Inside the keeper `process.memoryUsage()` is refused (EACCES); `/proc/meminfo` and `os.freemem()` work.

### Choose art on the TV (2026-11-16)

- Opening Art Mode from the Choose art screen: the art channel answered about 4 s later, and the keeper cached the list and all thumbnails in 2 s (3 Art Store pictures; the TV holds no own uploads). The cache lives in `/home/owner/apps_rw/FrameHome1/data/art-cache` and survived a reinstall.
- Picking a picture: `select_image` went out about 2 s after the choice. With `category_id` from the list (`MY-C0008`) the TV refused it (-7) for `SAM-S1111996`; with `category_id: null` it switched to `SAM-S4509` and announced `recently_set_updated`. Not yet separated: whether the category or that one picture caused the -7.
- The TV stopped both the launcher and the keeper 11 to 13 s after Art Mode came on, although Art Mode was opened from our app. After a pick, Home lands on Samsung's home.
- Sent before Art Mode had put up its own picture, a choice was recorded by the TV but the screen went back to the old picture. Waiting for Art Mode's own `image_selected` (about 2 s after it opens), then sending, worked: Baran saw the chosen picture (`SAM-S1111996`) stay, and `get_current_artwork` named it 7 s later. So the -7 earlier came from the category, not from that picture.
- `get_content_list` returned the same list for `MY-C0002`, `MY-C0004` and `MY-C0008` (the `category` field seems ignored). The slideshow is off.

### Art service in TV mode (2026-11-16)

The keeper's `/art-probe` (read-only `get_*` requests only) ran on the TV in TV mode: the art channel connected, and none of 12 requests answered within 4 s each (status, device info, current artwork, content lists, slideshow, rotation, brightness, colour temperature, art settings, mat list, photo filters). Art controls inside the launcher cannot be live outside Art Mode; changes would have to be queued and applied when Art Mode comes on.

### SmartThings power-on (2026-11-16, evening)

Read with a 24-hour token, through `tools/smartthings.mjs`; logs in `docs/private/smartthings-watch-2026-11-16b.log` and `artmode-sleep-2026-11-16b.log`.

- The TV's `switch` read `on` the whole evening: in Art Mode, through a long Art Mode stay and in TV mode. Its timestamp stayed at 21:42:28. A rule on `switch` would never see power-on, so it was not created.
- The TV tells SmartThings what is in front (`tvChannel.tvChannelName`: `art`, `com.samsung.tv.csfs`, `HEPsqFNie0.tvplusstandalone`, `FrameHome1.FrameHome`) only when SmartThings asks for a refresh. The power key at 22:17:16 (Art Mode to TV Plus) showed up only after a refresh at 22:19:42; the switch back to Art Mode at 22:21:12 only after a refresh at 22:23:54.
- So power-on is two rules: "Frame Home: ask the TV every minute" (a refresh every minute) and "Frame Home at power-on" (open Frame Home each time Samsung's home or TV Plus becomes the app in front).
- Test, same evening: power key in Art Mode at 22:26:48, Samsung's home came up, the poll saw it at 22:27:03, the launcher was on screen at 22:27:07. About 19 s; up to about a minute by design.
- Home twice (3 s apart) left Samsung's home up at 22:30:04; the next poll saw it at 22:31:03 and Frame Home came back at 22:31:05. The escape to Samsung's home lasts until the next poll.
- Power key back to Art Mode at 22:32:00: the app in front read `art` at 22:32:06, the rule stayed quiet, and the TV stopped the launcher within a minute as before.
- Hue Sync switches to its video mode whenever the TV comes into TV mode.
- The token's rate limit is about 10 requests in a short window; a watch every 12 s stays under it.
- The art channel from the Mac sometimes connects without `ms.channel.ready` while Art Mode is on; the Art app then answers when addressed by its own id. The earlier reading "channel does not open, so asleep" (20:45 to 22:20) is therefore not proof that the TV slept. SmartThings' power reading is always 0 W, and `PowerState` stayed `on`, so nothing seen from the Mac tells a sleeping Art Mode from an awake one.
- Not verified: that Art Mode still sleeps and wakes by itself with the minute poll running; power-on from a full power-off; that the rules keep running after the token ends (the next day) and after 2026-12-15.

### Not tested yet

- That Art Mode still sleeps and wakes by itself with the SmartThings minute poll running, and that the rules outlive their token.
- What the TV announces when it goes to sleep from Art Mode, and that Art Mode still sleeps and wakes by itself with the launcher installed. Nothing of ours runs during a long Art Mode stay, so no effect is expected.
- A full power-off (long press) and a cold start.
- Hours behind a streaming app with something playing.
- Home pressed from inside another app.
