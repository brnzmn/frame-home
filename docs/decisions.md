# Decisions

## 2026-11-10

- **No flashing.** No custom firmware or root exists for 2024–2026 Samsung TVs, and the firmware is signed. Samsung's home screen cannot be replaced.
- **Route:** our own launcher app ("Frame Home", working name) installed through Samsung's Developer Mode. Chosen over an Apple TV 4K (349 €), a Google TV box, or only tidying Samsung's settings.
- **First version (Baran's scope):**
  - tvOS-style app grid, dock and clock;
  - top shelf artwork;
  - HDMI input tiles;
  - experimental "hide Samsung's Home";
  - a Frame row: Art Mode, choose art, art settings;
  - a global frame look: mat style and colour set once for every image, new ones included.
- **Gate before any launcher UI work:** the test app survives a full power cycle, lists and opens apps, and has one way back in without hunting for it (power-on rule, or return after an app closes). The global frame look does not depend on this gate.
- **Toolchain:** Tizen Studio 6.1 command-line tools under Rosetta plus Samsung's certificate extension; `samsungframetv` (PyPI) for the Frame's art controls. Official tools and mainstream registries only.
- **Known ceilings:** the Home button stays Samsung's. Retail sets do not auto-start sideloaded apps, so power-on goes through a SmartThings rule. (2026-11-11: the Home button has an answer inside the app; power-on does not. See below.)
- **Not in the first version:** title deep links, cross-app "continue watching", replacing the Home button, rebuilding Art Mode, photo uploads from the launcher.
- **Look:** Baran sets the creative direction ("closer to Apple TV"). Original assets, no Apple artwork or fonts.
- **Model note:** Fable 5.2's safeguard stopped one research pass on this topic. The next tier for blocked work is Opus 5.5.
- **Certificate:** profile `framehome`; the author password is in the keychain as `samsung/tizen-author-cert`. Baran decided against a backup copy of the certificate files. If `~/SamsungCertificate/framehome/` is lost, uninstall the app from the TV and sign again with a new certificate.
- **Gate passed (2026-11-10):** the test app survives a full power cycle, lists and opens apps, and returns by itself after an app closes. The launcher goes ahead. Mats can be changed while Art Mode is on. See `docs/phase0-findings.md`.
- **Existing projects (checked 2026-11-10):** none is better as a whole; keep our launcher and art client and borrow techniques. Routes that need a root exploit stay out. See `docs/research-existing-projects.md`.
- **Mat tools are read-only by default.** No change-and-restore tests on Baran's images: a portrait mat cannot be set back to `none`.
- **Home button (Baran, 2026-11-11):** our own jump-back, with no change to the TV's system settings. The launcher returns when Samsung's home appears; pressing Home a second time within six seconds leaves Samsung's home up. It never acts while the Art app is in front.
- **Power-on is not solved inside the app (2026-11-11).** The TV stops the launcher and its service within a minute of the power key putting it into Art Mode, and starts neither again. A pending alarm prevented that only for a launcher started from the Mac, never in normal use, so it was removed. What stays in the app: it asks every second to be brought forward until it is on screen; coming back no longer reloads the page; and a background service (the keeper) listens to the TV's art channel from inside the TV. The keeper tells the launcher when the TV has said it is going to sleep, keeps the record of what both saw, and is the base for art controls later. It opens nothing: it cannot see which app is in front, and a second review (Codex, 2026-11-11) rightly objected to it opening the launcher on that basis.
- **Open, Baran's call:** how the launcher gets on screen at power-on. Either the SmartThings rule from the plan (needs a SmartThings token from him, runs through Samsung's cloud, has to be shown not to fire when Art Mode wakes by itself), or the TV's "home app" setting he declined on 2026-11-11 (unproven on this model), or leaving it at one OK press on Frame Home in Samsung's row.
- **SmartThings rule chosen for power-on (Baran, 2026-11-11).** Checked the same day from public sources, nothing yet on the TV:
  - a token lasts 24 hours ([SmartThings docs](https://developer.smartthings.com/docs/getting-started/authorization-and-permissions));
  - SmartThings started paid API plans on 2026-11-04 and has told token holders that all tokens end on 2026-12-15 ([quoted notice](https://community.home-assistant.io/t/smartthings-charging-for-api-access-as-of-december-15th-2026/1032782)), while [its blog](https://blog.smartthings.com/smartthings-updates/smartthings-api-additional-details-for-developers-and-business-partners/) says rules stay available through tokens, the Advanced Web App and the phone app, and only rules through OAuth need a plan. No plan is bought without Baran's yes;
  - no source says whether a rule made with a token keeps running once the token has ended. One public project doing exactly this on a 2025 set tells its users to delete the token afterwards. Check ours again some days after the token is gone;
  - no source says what a Frame's `switch` reads in Art Mode. If it reads `on` there, a rule on `switch` would miss power-on and fire when Art Mode wakes by itself, and this route is dead. A live read in each state decides (`node tools/smartthings.mjs watch`);
  - a rule can also be seen and removed, signed in and without a token, at my.smartthings.com/advanced.
- **Not used:** an alarm as a way to restart things (a firing alarm opens the launcher and ends Art Mode), and anything that depends on the TV's `PowerState`.
- **Design rules from the TV's measurements:** no live backdrop blur (31 fps); transforms are fine; the launcher keeps its own curated app list and its own fallback artwork, because the TV's list is mostly system parts and many icons do not load.
- **Speed rules (measured 2026-11-16):** a key press may change only transform and opacity, and never which full-screen layer shows: the colour glow cost 5 fps and 433 ms stalls, and 22 fps even pre-painted, so it is off. Focus shadows are pre-painted and fade. Result: 19 ms p95 from key to screen, 60 fps. Any new look is measured with `tools/lag-test.mjs` before Baran sees it.
- **Tiles (Baran, 2026-11-16):** Art Mode, Art settings, Settings / PS5, Netflix, Prime Video, Apple TV, Disney+ / SmartThings, Hue Sync, All apps. Everything else lives in All apps.
- **Art controls in the launcher (2026-11-16):** the art service does not answer in TV mode (12 read requests, none answered), so they cannot be live. Open, Baran's call: changes queued and applied when Art Mode comes on, or Art settings keeps opening Samsung's art screen.
- **Look (open, Baran's pick):** three trial looks on the TV, Gallery, Clean and Paper, in `app/src/looks/`, switched by `localStorage['frame-home.look']`. All run at 60 fps.
