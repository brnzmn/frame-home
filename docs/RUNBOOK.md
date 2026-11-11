# Runbook

How to get an app onto the TV and how to use the frame tools. Steps marked *unverified* have not yet been run against the TV.

## One-time setup on this Mac (done 2026-11-10)

- Tizen Studio 6.1 command-line tools in `~/tizen-studio` (x86_64, runs under Rosetta), with Certificate Manager and the Samsung Certificate Extension.
- Python environment for the frame tools: `uv venv tools/frame/.venv && uv pip install --python tools/frame/.venv/bin/python -r tools/frame/requirements.txt`.

## Developer Mode on the TV

1. TV on, out of Art Mode, on the same Wi-Fi as the Mac.
2. Apps, scroll to the bottom of the page, open **App Settings**. Press the remote's 123 button, choose the on-screen number pad and enter 1 2 3 4 5. In the box that appears set Developer mode On and Host PC IP = the Mac's address on the TV's own network (`macIp` in `.tv.json` after `node tools/find-tv.mjs`). If the number pad does nothing, type 12345 from the SmartThings phone app's remote keypad instead. (*unverified on this TV*)
3. Fully power-cycle the TV (hold power until it is off, wait 15 seconds; or unplug for 15 seconds).
4. `node tools/find-tv.mjs --need-dev` must print the TV. It writes `.tv.json`.

## Certificate (*unverified*)

1. `~/tizen-studio/tools/sdb connect <tv-ip>:26101`, then `~/tizen-studio/tools/sdb -s <tv-ip>:26101 shell 0 getduid`.
2. `open ~/tizen-studio/tools/certificate-manager/certificate-manager.app`, add a **Samsung** profile for **TV** named `framehome`: new author certificate (Baran types the password and signs in to Samsung), new distributor certificate, privilege Public, paste the DUID.
3. Back up `~/SamsungCertificate/framehome/author.p12`. Every later update must use this same author certificate.

## Deploy (*unverified*)

- `node tools/deploy.mjs probe` packages, signs, installs and opens the probe.
- `node tools/deploy.mjs probe --debug` opens it with the debug port forwarded to `localhost:9222`, then:
  - `node tools/tv-inspect.mjs shot docs/private/tv.png`
  - `node tools/tv-inspect.mjs eval "JSON.stringify(window.__report.checks)"`
  - `node tools/tv-inspect.mjs key ArrowDown Enter`
- `node tools/probe-server.mjs` collects the probe's report into `docs/probe-report.json`.

Known install errors: `[118,-12] Invalid certificate chain` means a non-Samsung certificate; `Device is not registered` means the DUID is missing from the distributor certificate; `[118,-11] Author certificate not match` means an older copy signed with another certificate is still installed, so uninstall it first.

## Frame tools (*unverified*)

Run with `tools/frame/.venv/bin/python`:

- `tools/frame/pair.py`: pair once; press Allow on the TV.
All of them need the TV in Art Mode; asleep or on the home screen its art service does not answer.

- `tools/frame/check.py`: read-only. What the TV reports about art, mats, filters, settings, the slideshow and its images.
- `tools/frame/apply_look.py`: dry run of the global frame look from `frame-look.json`. `--apply` saves the current mats to `docs/private/` and replaces each mat an image already has. It never adds a mat where an image has none, because the TV will not take it back off. `--restore FILE` puts a backup back. The reworked version has only been dry-run against the TV.
- `tools/frame/snapshot.py`: saves the Art Mode settings to `docs/art-settings-snapshot.json`.
- `tools/frame/key.py`: presses remote keys from the Mac. `tools/frame/raw.py`: prints the art channel's raw traffic.

## After a firmware update

If the app is gone or Developer Mode is off: redo "Developer Mode on the TV", then `node tools/deploy.mjs <app>`.
