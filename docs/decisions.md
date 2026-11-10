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
- **Known ceilings:** the Home button stays Samsung's. Retail sets do not auto-start sideloaded apps, so power-on goes through a SmartThings rule.
- **Not in the first version:** title deep links, cross-app "continue watching", replacing the Home button, rebuilding Art Mode, photo uploads from the launcher.
- **Look:** Baran sets the creative direction ("closer to Apple TV"). Original assets, no Apple artwork or fonts.
- **Model note:** Fable 5.2's safeguard stopped one research pass on this topic. The next tier for blocked work is Opus 5.5.
