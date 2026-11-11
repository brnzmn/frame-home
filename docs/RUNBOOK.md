# Runbook

How to get an app onto the TV, how to check it there, and how to use the frame tools. Steps marked *unverified* have not yet been run against the TV.

## One-time setup on this Mac (done 2026-11-10)

- Tizen Studio 6.1 command-line tools in `~/tizen-studio` (x86_64, runs under Rosetta), with Certificate Manager and the Samsung Certificate Extension.
- Python environment for the frame tools: `uv venv tools/frame/.venv && uv pip install --python tools/frame/.venv/bin/python -r tools/frame/requirements.txt`.

## Developer Mode on the TV

1. TV on, out of Art Mode, on the same Wi-Fi as the Mac.
2. Apps, scroll to the bottom of the page, open **App Settings**. Press the remote's 123 button, choose the on-screen number pad and enter 1 2 3 4 5. In the box that appears set Developer mode On and Host PC IP = the Mac's address on the TV's own network (`macIp` in `.tv.json` after `node tools/find-tv.mjs`). If the number pad does nothing, type 12345 from the SmartThings phone app's remote keypad instead. (*unverified on this TV*)
3. Fully power-cycle the TV (hold power until it is off, wait 15 seconds; or unplug for 15 seconds).
4. `node tools/find-tv.mjs --need-dev` must print the TV. It writes `.tv.json`.

## Certificate (done 2026-11-10)

1. `~/tizen-studio/tools/sdb connect <tv-ip>:26101`, then `~/tizen-studio/tools/sdb -s <tv-ip>:26101 shell 0 getduid`.
2. `open ~/tizen-studio/tools/certificate-manager/certificate-manager.app`, add a **Samsung** profile for **TV** named `framehome`: new author certificate (Baran types the password and signs in to Samsung), new distributor certificate, privilege Public, paste the DUID. The wizard ignores clicks sent from another app; a person has to click it.
3. Baran decided against a backup of the certificate files. If `~/SamsungCertificate/framehome/` is lost, uninstall the app from the TV and sign again with a new certificate.

## The launcher on the TV

- `pnpm exec vitest run` runs the tests. They include the background service against a fake TV.
- `pnpm exec vite build && node tools/deploy.mjs build/app` builds, signs, installs and opens it. The TV must be awake and this Mac on the TV's Wi-Fi.
- `--debug` opens it with the debug port on `localhost:9222`; then `node tools/tv-inspect.mjs shot FILE`, `eval "…"`, `key ArrowDown Enter`. The port drops as soon as the launcher is hidden.
- `--open-only` skips the install and only opens it.
- `--report` makes the background service post its record, and the launcher's, to `node tools/probe-server.mjs` on this Mac. This is the way to see what happens while the launcher is hidden. Without it the service reports nowhere.
- The launcher's own record is `localStorage['frame-home.trace']`; the service's is its status page, `http://127.0.0.1:47811/` on the TV (readable from the launcher's debug port).
- `node tools/watch-launcher.mjs 60` prints each change of the TV's power state and the launcher's state for a minute. `--hours 12 --log FILE` keeps a long watch and stops early once the launcher has stopped.

### Checks after any change to coming back or to the service

Press keys with `tools/frame/.venv/bin/python tools/frame/key.py`. Art Mode is always entered with `KEY_POWER`. A launcher that was just installed or opened from the Mac behaves differently from one in normal use, so press Home once before judging anything about Art Mode.

1. `KEY_HOME` on the launcher: back in under a second.
2. `KEY_HOME wait:2.5 KEY_HOME`: Samsung's home stays up.
3. Open an app from the launcher, close it (`KEY_EXIT`, twice in YouTube): the launcher is back.
4. `KEY_POWER wait:10 KEY_POWER`: the launcher is back after a short Art Mode visit.
5. `KEY_POWER wait:300 KEY_POWER`: expected today is Samsung's home, with the launcher not running. If that ever changes, write it down.
6. Leave the TV in Art Mode and confirm Art Mode still sleeps and wakes by itself.

Known install errors: `[118,-12] Invalid certificate chain` means a non-Samsung certificate; `Device is not registered` means the DUID is missing from the distributor certificate; `[118,-11] Author certificate not match` means an older copy signed with another certificate is still installed, so uninstall it first.

## Frame tools

Run with `tools/frame/.venv/bin/python`:

- `tools/frame/pair.py`: pair once; press Allow on the TV.
All of the others need the TV in Art Mode; asleep or on the home screen its art service does not answer the Mac.

- `tools/frame/check.py`: read-only. What the TV reports about art, mats, filters, settings, the slideshow and its images.
- `tools/frame/apply_look.py`: dry run of the global frame look from `frame-look.json`. `--apply` saves the current mats to `docs/private/` and replaces each mat an image already has. It never adds a mat where an image has none, because the TV will not take it back off. `--restore FILE` puts a backup back. The reworked version has only been dry-run against the TV.
- `tools/frame/snapshot.py`: saves the Art Mode settings to `docs/art-settings-snapshot.json`.
- `tools/frame/key.py`: presses remote keys from the Mac, with `wait:N` pauses between them. `tools/frame/raw.py`: prints the art channel's raw traffic.

## After a firmware update

If the app is gone or Developer Mode is off: redo "Developer Mode on the TV", then `node tools/deploy.mjs <app>`.
