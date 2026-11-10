# Frame Home: a tvOS-style launcher for the Frame Pro

## Context

- The problem is Samsung's home screen on the Frame Pro 65" (`TQ65LS03FWUXXC`, 2025, Tizen 9). The goal is a home that feels like Apple TV.
- **Flashing is out.** No custom firmware or root exists for any 2024–2026 Samsung TV, and the firmware is signed. Samsung's home cannot be replaced.
- **Decided 2026-11-10:** build our own launcher app ("Frame Home", working name, yours to change) and install it through Samsung's official Developer Mode. Nothing in the firmware changes, and uninstalling the app undoes everything.
- **First version, as you chose:** tvOS-style app grid, top shelf artwork, HDMI input tiles, and the experimental "hide Samsung's Home".
- **Added on your review:**
  - easy access to the Frame's own features: Art Mode, choosing artwork (Art Store, favourites, your photos), art settings;
  - a **global frame look**: your mat (the band around the artwork: its style, which sets the width, and its colour) and similar per-image options are set once and applied to every image, new ones included, instead of fixing each image in the menu.
- **Known ceiling:** an app cannot take over the Home button. Retail Samsung sets also do not auto-start sideloaded apps, so power-on needs a workaround (below).
- **Evidence it can work:**
  - Launcher: a Frame Pro 2025 owner got Developer Mode installs working after a full power cycle (Dec 2025), and an open-source launcher of this kind runs on a 2025 Tizen 9 set.
  - Frame look: the TV's art controls over Wi-Fi (what the phone app uses) are reported working on 2021–2024 Frames and are in use on 2025 Frames. Changing mats on a 2025 Frame Pro is unconfirmed.
  - Nothing is verified on your TV yet, so no design work happens before the tests in Phase 0.

## Target

- **Repo:** new, `/Volumes/disk1/Projects/frame-home`, private on GitHub under `brnzmn`.
- **Deploy surface:** the TV itself, over home Wi-Fi (this Mac is `192.168.0.11`; the TV was not visible today, probably off).
- **Accounts:** your Samsung account (certificate, you sign in), TMDB (artwork key), SmartThings (power-on rule).

## How it fits together

```
 Mac (192.168.0.11)                            Frame Pro (Tizen 9)
┌────────────────────────────┐              ┌─────────────────────────────────┐
│ frame-home repo            │── install ──▶│ Frame Home app                  │
│  app (Vite + TypeScript)   │◀ screenshots │  Frame row · dock · app grid    │
│  fake-TV mode for browser  │   + report ──│  top shelf · inputs · settings  │
│  probe + deploy scripts    │              ├─────────────────────────────────┤
│  frame-look tools          │── Wi-Fi ────▶│ TV's art controls               │
└────────────────────────────┘              │  mats · Art Mode · art settings │
                                            └────────┬───────────────┬────────┘
 SmartThings rule (cloud):                    opens  │               │ https
 "TV turned on → open Frame Home"                    ▼               ▼
                                    Netflix, YouTube, Prime …    TMDB artwork
                                    Art Mode, Art Store
```

## Phase 0: prove it on your TV (go / no-go)

1. Create the project folder and repo, and move this session there.
2. Download the 0.7 MB `sdb` tool. Once Developer Mode is on, run `sdb connect <tv>:26101` and `sdb shell 0 getduid`, and read `http://<tv>:8001/api/v2/` for the firmware version. This is the cheapest proof that the TV accepts developer connections, before the big install.
3. **Art controls test from the Mac.** Pair with the TV (you press Allow once), list your images and the mats the TV offers, change one image's mat and change it back, switch Art Mode on and off.
4. Install the Tizen Studio 6.1 command-line tools (runs under Rosetta, Java bundled) plus Samsung's certificate extension.
5. Create the Samsung certificate in Certificate Manager. I drive the clicks; you type the certificate password and sign in to Samsung. The certificate files stay in `~/SamsungCertificate/` and `~/tizen-studio-data/`, outside the repo, with a backup of `author.p12`.
6. Build and install a **probe app**. It shows its results on the TV and posts them to the Mac, and I attach to the TV's debug port for console output and screenshots. It checks:
   - model, firmware, browser engine version, screen size;
   - the installed-app list and how many icons load;
   - opening an app, and what the TV shows when that app is closed;
   - the Frame's own screens (Art Mode, Art Store, art settings): whether our app can open each;
   - whether our app can reach the art controls itself (for the mat and for one-press Art Mode);
   - what our app is told when the Home button is pressed;
   - whether the TV's built-in window API can show an HDMI input from inside the app;
   - reaching TMDB over HTTPS;
   - frame rate of the focus animation, with and without blur;
   - the remote's key codes.
7. Fully power the TV off and on, then confirm the app is still installed. (Samsung's FAQ says developer-installed apps can be removed at power-off; owners report they stay.)
8. Create the SmartThings power-on rule and confirm it opens the app after the TV turns on. Also confirm it stays quiet when Art Mode wakes or sleeps on its own (motion sensor, night mode), because firing then would pull the TV out of Art Mode.

**Gate.** Go on the launcher only if the app survives a power cycle, lists and opens apps, and has at least one way back in without hunting for it (the power-on rule, or returning after an app closes). If the first two fail, I stop the launcher and recommend a box instead. If only the third fails, you decide whether "a nice app you open by hand" is worth building.

The global frame look depends on step 3, not on this gate. If the launcher fails, that part can still ship.

## Phase 1: home screen (Frame row, app grid, dock, clock)

- **Stack:** Vite + TypeScript, no UI framework, our own remote-control focus engine. One TV interface with two implementations: the real Tizen APIs, and a fake-TV mode so the whole thing runs in a desktop browser at 1920×1080 with arrow keys.
- **Look (your direction, "closer to Apple TV"):** large rounded tiles, focus zoom with a soft shadow, a dock row, a clock, a backdrop tinted by the focused artwork. Original assets and a free typeface; no Apple artwork.
- **Frame row:** a fixed group in first position for the Frame's own features: **Art Mode** (go to art now), **Choose art** (Art Store, favourites, your photos) and **Art settings**. Each opens Samsung's own screen for it. Where the art controls are reachable, Art Mode is a true one-press switch. Anything else Samsung ships as an app (Gaming Hub, SmartThings, Multi View) shows up as a normal tile.
- **Checkpoint:** I send you a screenshot of the first visual pass early. Your notes decide the look.
- **Behaviour:** apps come from the TV's own list; reorder and hide in a settings sheet stored on the TV; the launcher comes back when a launched app closes, if the probe shows that works; a "Samsung menu" tile for the stock settings.
- **Power-on:** the SmartThings rule from Phase 0, with Frame Home also pinned first in Samsung's app row.

## Phase 2: global frame look

- **Set once:** mat style (which sets the band's width and shape), mat colour and photo filter, picked from the list the TV itself offers and stored in `frame-look.json`. You choose in the launcher's settings; until that screen exists, you tell me and I set it.
- **Apply to all:** one action puts that look on every image in your collection and lists any image the TV refuses (some shapes and some Art Store pieces take no mat).
- **New images:** picked up automatically. First choice is the launcher doing it each time it opens. If the TV does not let its own app reach the art controls, a small helper does it: on an always-on device at home if you have one, otherwise this MacBook whenever it is home and awake.
- **Record:** a snapshot of your Art Mode settings (brightness, colour tone, sleep and motion options) is saved, so they can be re-applied after a reset or firmware update.

## Phase 3: top shelf artwork

- A hero banner that follows the focused app, showing popular films and series for that service in Spain (TMDB). Selecting it opens the app, not the title.
- Cached on the TV, with fallback artwork offline, and the TMDB credit in settings.
- Needs a free TMDB key. I look for one you already have before asking you to create one.

## Phase 4: HDMI input tiles

Use the first method that works on your TV, in this order:
1. the TV's window API inside the app (no extra parts);
2. Samsung's "IP Remote" control, a TV setting you switch on, driven by the same helper as the frame look;
3. SmartThings through a small function on your Cloudflare (one SmartThings sign-in).

If none works cleanly, the tiles are left out and I say so.

## Phase 5: hide Samsung's Home (experimental)

- Built only if the probe shows the TV tells our app clearly when Samsung's home comes forward.
- Behind a toggle in settings, with the "Samsung menu" tile pausing it for 60 seconds so you can always reach Samsung's settings.
- It may not cover pressing Home from inside another app. I will state exactly what it covers after the probe.

## Phase 6: keep it alive

- One command, `pnpm deploy:tv`, builds, signs, installs and opens the app.
- `docs/RUNBOOK.md` covers re-installing after a firmware update or certificate expiry. `docs/decisions.md` holds decisions. `AGENTS.md` stays short.

## Your part (about 10 minutes, once)

1. Turn the TV on, out of Art Mode, on the same Wi-Fi as this Mac.
2. On the TV open **Apps**, press **1 2 3 4 5** on the remote's number pad (the 123 button), set **Developer mode** to **On**, enter `192.168.0.11` as Host PC IP (I re-check the address first), press OK.
3. Hold the remote's power button until the TV switches fully off, wait 15 seconds, switch it on. If Developer mode is not shown in Apps afterwards, unplug the TV for 15 seconds instead.
4. Press **Allow** on the TV when it asks whether this Mac may connect.
5. When Certificate Manager opens on the Mac, type a password of your choice when asked and sign in to your Samsung account when the sign-in page appears.
6. If macOS asks whether an app may find devices on your local network, click **Allow**.

Later, only when reached: make sure the TV is in the SmartThings phone app and create a short-lived SmartThings token for the power-on rule; create a TMDB key if you have none; tell me whether anything at home is always on (Mac mini, NAS, Raspberry Pi, Home Assistant).

## Downloads (approving this plan approves these)

| File | Size | Source |
|---|---|---|
| `sdb_4.2.36_macos-64.zip` | 0.7 MB | download.tizen.org (official) |
| `web-cli_Tizen_Studio_6.1_macos-64.bin` | 280 MB | download.tizen.org (official) |
| Samsung Certificate Extension `cert-add-on` | about 44 MB | Tizen Studio's own package manager |
| `samsungframetv` (open-source library for the Frame's art controls, LGPL-3.0) | small | PyPI |
| `vite`, `typescript`, `vitest` | small | npm |

No community installers. Anything outside this list, I ask first. Total spend: 0 €.

## Files (new repo)

- `config.xml`: the TV app manifest (permissions, background running, resolution).
- `src/platform/{tv.ts,tizen.ts,mock.ts}`: the TV interface, the real one, the fake one.
- `src/focus/engine.ts`: remote-control navigation.
- `src/ui/{home,dock,grid,topshelf,inputs,frame,settings}.ts`, `src/data/{apps,tmdb,inputs,frame}.ts`.
- `probe/`: the capability probe app. `tools/{probe-server,deploy}.mjs`.
- `tools/frame/{pair,apply_look,snapshot}.py`, `frame-look.json`: the global frame look.
- `docs/{probe-report.json,art-settings-snapshot.json,RUNBOOK.md,decisions.md}`, `AGENTS.md`, `CLAUDE.md`.
- Reference to read for technique, not to copy: `jasimcm/tinkerspace-tv` (launcher and SmartThings power-on rule on a 2025 set), `ferdj40/samsung-tv-launcher`.

## Verification

- **Phase 0:** `sdb devices` lists the TV; `docs/probe-report.json` arrives from the TV; a screenshot of the probe taken through the TV's debug port; the app still present after a full power cycle; the power-on rule opens it.
- **App:** unit tests for the focus engine only (moving between rows, edges, hidden tiles); a run in the browser preview at 1920×1080; then on the TV through the debug port, with key presses sent from the Mac and screenshots back.
- **Frame row:** each tile opens the right Samsung screen on the TV, and Art Mode still starts and sleeps the way it did before.
- **Global frame look:** after "apply to all", the TV's own image list reports the chosen mat on every image that accepts one, with the refused ones listed; you confirm two images on the screen; a newly added photo picks up the look without a menu visit.
- **Done** means seen working on the TV. Anything not confirmed there is labelled unverified. The final feel check is your eyes on the TV.

## Risks and fallbacks

- **TV refuses the developer connection:** full power cycle, fixed address for the Mac. If it still refuses, stop the launcher and go to a box (Apple TV 4K at 349 €, or a Google TV box).
- **The TV refuses mat changes over Wi-Fi:** confirmed on 2021–2024 Frames, unconfirmed on a 2025 Frame Pro. If it refuses, a global mat is not possible, I say so, and the on-TV menu stays the only way.
- **Certificate tool fails under Rosetta, or Samsung's certificate service errors:** Samsung's official VS Code extension has the same certificate flow. Community tools only with your explicit OK.
- **A firmware update switches Developer Mode off or removes the app:** redo your steps 2–3 and run `pnpm deploy:tv`. Turning off TV auto-update is your call.
- **No auto-start for sideloaded apps:** the SmartThings rule; otherwise Frame Home sits first in Samsung's row.
- **Power-on rule against Art Mode:** if SmartThings reports Art Mode waking as "TV on", the rule would kick the TV out of Art Mode. Phase 0 tests this. If it misfires, the rule is narrowed or dropped and the launcher is opened from Samsung's row.
- **Safeguard:** Fable 5.2 stopped one research pass on this topic. If it stops implementation work, the next tier is Opus 5.5.
- **Legal:** personal use on your own TV with original assets; not something to distribute as is.

## Not in the first version

- Opening a specific film or series inside Netflix and the like (no verified links).
- "Continue watching" across apps (not available to third-party apps).
- Replacing the Home button.
- Rebuilding Art Mode itself. The Frame row links to Samsung's art screens.
- Uploading photos from the launcher, or a drop-folder on the Mac that uploads photos with your mat already applied. Both are possible later with the same art controls.
