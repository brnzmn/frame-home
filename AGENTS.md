# frame-home

A tvOS-style launcher ("Frame Home") and a global frame look for Baran's Samsung Frame Pro 65" (2025, Tizen 9), installed through Samsung's Developer Mode. Decisions are in `docs/decisions.md`, the approved plan in `docs/plan.md`.

## Rules

- Flashing or rooting the TV is out. Do not reopen it without new public evidence.
- Nothing is done until it is seen working on the TV. Label anything else unverified.
- The gate in `docs/decisions.md` comes before any launcher UI work.
- Never commit anything that identifies the TV, this Mac or an account: DUID, MAC addresses, pairing tokens, certificates, API keys. Local values live in `.tv.json`, `tools/frame/.tokens/` and `.env.local`, all gitignored.
- The Samsung certificate lives in `~/SamsungCertificate/` and `~/tizen-studio-data/`. Every update must be signed with the same author certificate, or the TV rejects the install.
- Only official Samsung/Tizen tools and mainstream registries. Community installers need Baran's explicit OK.
- Baran types every password and does every sign-in himself.
- Art Mode must keep working as it did. After any change that touches power-on or the art controls, check that Art Mode still starts and sleeps on its own.

## Gotchas

- Tizen Studio's macOS binaries are x86_64 and run under Rosetta. `tizen` is in `~/tizen-studio/tools/ide/bin`, `sdb` in `~/tizen-studio/tools`.
- After Developer Mode is switched on the TV needs a full power cycle, and its Host PC IP must equal this Mac's address on the TV's own network.
- The house has two networks: the router's `192.168.0.x` and the mesh Wi-Fi's `192.168.86.x`. The TV is on the mesh, so the Mac must be on that Wi-Fi to reach it. `node tools/find-tv.mjs` writes both addresses to `.tv.json`.
- This Mac hops back to the router's Wi-Fi by itself. If the TV stops answering (empty debug output, failed transfer, key presses timing out), check `ipconfig getifaddr en0` first: it must be `192.168.86.x`.
- On 2024 and later sets the Developer Mode code 12345 is entered inside Apps > App Settings (bottom of the Apps page), not on the Apps page itself (owner reports; not yet confirmed on this TV).
- The TV's debug port serves one client at a time.
- Retail Samsung sets do not auto-start sideloaded apps; "Autorun Last App" ignores them.
- The TV's `PowerState` does not tell Art Mode from TV mode: it reads `on` in both for at least minutes. Never decide anything on it alone.
- The desktop app's preview servers cannot read `/Volumes/disk1` without a macOS removable-volume permission. Run local servers from the shell, or from a copy on the internal disk.
- Animation frames stop while a page is hidden, so frame-rate numbers only count when the app is on screen.
- Never take a debug-port screenshot while the app is hidden; it coincided with the app going silent.
- A `.wgt` file name with a space fails to install with an empty log. `tools/deploy.mjs` renames it.
- The art service answers only while Art Mode is on. Use `tools/frame/artws.py`; the `samsungframetv` classes fail on this TV's connect order.
- After `change_matte`, `get_current_artwork` still shows the old mat. Verify with `get_slideshow_status` or `get_content_list`.
- `change_matte` with only `matte_id` also rewrites `portrait_matte_id`. Always send both.
- `change_matte` error -7 means the TV refuses that mat for that image. It always refuses `none` as a portrait mat, so never add a mat where an image has none: it cannot be undone. No change-and-restore tests on his images.
- Own uploads have content ids starting with `MY`. Category `MY-C0008` is the recently shown list and also holds Art Store images.
- With the TV asleep the art channel does not open at all.
- A hidden app brings itself forward by launching its own id, which reloads the page. Save state first.
- If `sdb connect` is refused or an install hangs with the TV awake and the addresses right, the Mac's bridge server is stale: `sdb kill-server`, then connect. `tools/deploy.mjs` does this.
- The TV does not process installs while asleep. Wake it first (`tools/frame/key.py KEY_POWER`).
- The debug port drops whenever the launcher is hidden, and the TV will not open a running app in debug mode. To inspect after a test, run the full `deploy.mjs build/app --debug`; the launcher's storage survives it. Its own record is `localStorage['frame-home.trace']`.
- A hidden page's timers fire once a second. Anything that must react fast has to act in the event itself.
- The TV's app-status page lags by seconds around app switches; never use it for timing.
- Samsung's home in front is `com.samsung.tv.csfs`; Art Mode is `org.tizen.art-app`. The jump-back must only ever act on the first.
- The power key into Art Mode makes the TV stop our launcher and its service within a minute, and it starts neither again. So nothing of ours runs after a real Art Mode stay.
- A launcher started from the Mac (`tizen run`, a deploy) is treated differently from one in normal use: with an alarm pending it survived Art Mode, and after one Home press it did not. Never judge survival right after a deploy; press Home once first, then stay in Art Mode for minutes.
- An alarm that fires opens the launcher and ends Art Mode. Do not use alarms to restart anything.
- Opening the Art app from our launcher also gets launcher and keeper stopped, about 11-13 s in (2026-11-16); the keeper still gets the art channel's first seconds. Test the power-key case with the power key.
- Choose art: send `select_image` with `category_id: null` (the list's category got -7), and only after Art Mode's own `image_selected` on opening, or Art Mode puts its picture back. The cache in `apps_rw/FrameHome1/data/art-cache` survives a reinstall.
- The TV drops a request to open an app while it is still leaving Art Mode (up to about 7 seconds). Ask again until it is on screen.
- A page hidden for minutes cannot rely on its own timers. Only the worker-driven tick keeps time.
- The service (`app/public/service/keeper.js`) runs on Node 18 with no packages and is shipped unbuilt. It reaches the art channel at `ws://127.0.0.1:8001` with no token. It cannot see which app is in front, so it must never open the launcher or anything else.
- To see what launcher and service do while hidden: `node tools/probe-server.mjs`, then `deploy.mjs build/app --report`. Their joint record lands in `docs/private/probe-events.log`. A new test run gets a new file name; never empty an old log.
- SmartThings tokens last 24 hours and Samsung has said all of them end on 2026-12-15. Never build anything that needs a token at run time; a rule on the account is the only thing that may stay.
- While the launcher is on screen, a waking console cannot take the screen (black flash, back to us) and then drops off the input list. The launcher must open the input itself; see `newlyConnected` in `app/src/lifecycle.ts`.
- An HDMI input on screen is `org.tizen.tv-viewer`; launching that id shows the current source (`tizen.tvwindow.setSource` picks it).
- An app in front may report another id than its store id (YouTube is `com.samsung.tv.cobalt-yt`), and the TV's app-status page only knows store apps.
- Apple TV and Hue Sync make the TV stop our hidden launcher within about a minute (not memory); the keeper survives. Home then stays on Samsung's home. Netflix does not do this.
- `deploy.mjs --open-only --debug` hangs while the launcher still runs hidden; use the full `deploy.mjs build/app --debug`. macOS has no `timeout` command.

## Commands

- `node tools/find-tv.mjs`: find the TV on the LAN and write `.tv.json`.
- `node tools/probe-server.mjs`: receive the probe report the TV posts.
- `node tools/tv-inspect.mjs`: evaluate, send keys and take screenshots through the TV's debug port.
- `node tools/deploy.mjs <app folder> [--debug] [--report] [--open-only]`: package, sign, install and open an app on the TV.
- `node tools/smartthings.mjs devices | status | watch | launch | rule`: the TV on SmartThings and the power-on rule. Needs Baran's token in the keychain as `smartthings/frame-home`.
- `node tools/watch-launcher.mjs [seconds]` or `--hours N --log FILE`: what the TV says about itself and the launcher, from the Mac.
- Launcher: `pnpm exec vite` for the fake-TV preview on `127.0.0.1:5173`, `pnpm exec vitest run` for the navigation tests, `pnpm exec vite build && node tools/deploy.mjs build/app --debug` to put it on the TV.
- `tools/frame/.venv/bin/python tools/frame/{pair,check,apply_look,snapshot}.py`: the Frame's art controls. See `docs/RUNBOOK.md`.
