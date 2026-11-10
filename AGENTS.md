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
- On 2024 and later sets the Developer Mode code 12345 is entered inside Apps > App Settings (bottom of the Apps page), not on the Apps page itself (owner reports; not yet confirmed on this TV).
- The TV's debug port serves one client at a time.
- Retail Samsung sets do not auto-start sideloaded apps; "Autorun Last App" ignores them.
- 2025 Frames report `PowerState: standby` while in Art Mode.
- The desktop app's preview servers cannot read `/Volumes/disk1` without a macOS removable-volume permission. Run local servers from the shell, or from a copy on the internal disk.
- Animation frames stop while a page is hidden, so frame-rate numbers only count when the app is on screen.

## Commands

- `node tools/find-tv.mjs`: find the TV on the LAN and write `.tv.json`.
- `node tools/probe-server.mjs`: receive the probe report the TV posts.
- `node tools/tv-inspect.mjs`: evaluate, send keys and take screenshots through the TV's debug port.
- `node tools/deploy.mjs <app folder> [--debug]`: package, sign, install and open an app on the TV.
- `tools/frame/.venv/bin/python tools/frame/{pair,check,apply_look,snapshot}.py`: the Frame's art controls. See `docs/RUNBOOK.md`.
