# frame-home

A tvOS-style launcher ("Frame Home") and a global frame look for a Samsung Frame Pro (2025, Tizen 9), installed through Samsung's Developer Mode. No firmware is modified.

- `app/`: the launcher. `app/src` is the home screen, `app/public/service/keeper.js` its background service on the TV.
- `probe/`: the test app that recorded what the TV allows.
- `tools/`: finding the TV, deploying, inspecting, the SmartThings power-on rules (`smartthings.mjs`) and the frame-look tools (`frame/`).
- `docs/plan.md`: the approved plan and its phases.
- `docs/decisions.md`: what was decided and why.
- `docs/phase0-findings.md`: what was measured on the TV.
- `docs/RUNBOOK.md`: how to deploy to the TV and use the frame tools.

## Status (2026-11-17)

Working on the TV:

- Frame Home with Baran's tiles, in the Clean look.
- Home: Frame Home jumps back over Samsung's home. Home pressed again shows Samsung's home until the power-on rule's next check, up to a minute later, brings Frame Home back.
- Choose art: the pick is applied when Art Mode opens.
- Power-on: two SmartThings rules bring Frame Home up about 19 s after the power key (measured 2026-11-16).

Not verified yet: power-on after the TV has switched itself fully off, and the rules after their token expires. Known limits: the Home button stays Samsung's, and Apple TV or Hue Sync can stop the hidden launcher. Details are in `docs/phase0-findings.md`.
