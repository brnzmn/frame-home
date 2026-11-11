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
- **Power-on is not solved inside the app (2026-11-11).** The TV stops the launcher and its service within a minute of the power key putting it into Art Mode, and starts neither again. A pending alarm prevented that only for a launcher started from the Mac, never in normal use, so it was removed. What stays in the app: it asks every second to be brought forward until it is on screen; a background service (the keeper) opens it when Art Mode ends and something is still alive, which covers short stays; coming back no longer reloads the page.
- **Open, Baran's call:** how the launcher gets on screen at power-on. Either the SmartThings rule from the plan (needs a SmartThings token from him, runs through Samsung's cloud, has to be shown not to fire when Art Mode wakes by itself), or the TV's "home app" setting he declined on 2026-11-11 (unproven on this model), or leaving it at one OK press on Frame Home in Samsung's row.
- **Not used:** an alarm as a way to restart things (a firing alarm opens the launcher and ends Art Mode), and anything that depends on the TV's `PowerState`.
- **Design rules from the TV's measurements:** no live backdrop blur (31 fps); transforms and shadows are fine (55 to 59 fps); the launcher keeps its own curated app list and its own fallback artwork, because the TV's list is mostly system parts and many icons do not load.
