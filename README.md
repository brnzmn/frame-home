# frame-home

A tvOS-style launcher ("Frame Home") and a global frame look for a Samsung Frame Pro (2025, Tizen 9), installed through Samsung's Developer Mode. No firmware is modified.

- `app/`: the launcher. `app/src` is the home screen, `app/public/service/keeper.js` its background service on the TV.
- `probe/`: the test app that recorded what the TV allows.
- `tools/`: finding the TV, deploying, inspecting, the SmartThings power-on rules (`smartthings.mjs`) and the frame-look tools (`frame/`).
- `docs/plan.md`: the approved plan and its phases.
- `docs/decisions.md`: what was decided and why.
- `docs/phase0-findings.md`: what was measured on the TV.
- `docs/RUNBOOK.md`: how to deploy to the TV and use the frame tools.

## Status (2026-11-18)

Removed from the TV at Baran's request: he found it slowed the whole TV. Frame Home and its service are uninstalled; the SmartThings power-on rules are to be deleted once a new token is in the keychain. The code and the findings stay here for reference. Details are in `docs/decisions.md` and `docs/phase0-findings.md`.
