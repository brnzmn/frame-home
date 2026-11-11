# Existing projects, checked 2026-11-10

Baran asked whether someone had already built this. Two research passes read the public repos.
Nothing below was run; claims are marked by how they were checked.

**Verdict: keep our launcher and our art client, and borrow specific techniques.** No project is better as a whole. Almost all were created in October 2026 and have a handful of stars.

## Launchers

| Repo | What it is | Tested on | Licence |
|---|---|---|---|
| [helalaou/AeroTizen](https://github.com/helalaou/AeroTizen) | Web launcher, background service, Python CLI, .NET helpers | 2024 Frame LS03D (Tizen 9), S90C, Q70D | MIT |
| [dylanfernandezdelara/samsung-tv-launcher](https://github.com/dylanfernandezdelara/samsung-tv-launcher) | Plain web app with an iPhone remote | One 2026 TV, Tizen 10 | MIT |
| [willysvarela/tizen-launcher](https://github.com/willysvarela/tizen-launcher) | Apple-TV-style web app with title links | One 2024 TV, Tizen 9 | none stated |
| [NelsonEU/arn0-tv](https://github.com/NelsonEU/arn0-tv) | Web app plus a .NET Home helper | Q70B, Tizen 6.5 | none stated |
| [AnthonMS/samsung-tv-launcher](https://github.com/AnthonMS/samsung-tv-launcher) | Native C# launcher | Q60C, Tizen 9 | MIT |

Not worth adopting: shiftynick and AnthonMS need a root exploit, which is out for this project; zerodevb/garage-home needs root and is non-commercial; Prism targets one monitor; jasimcm is only the SmartThings rule; ferdj40 is an article.

### What they do that we do not

1. **Home button.** AeroTizen reports making Home open its launcher on retail firmware without root, by changing the TV's "home app" setting through the Developer Mode connection. Its README says the change is saved and reversible. Reported working on a 2024 Frame; unverified on the 2025 Frame Pro; one 2025 Tizen 9 set failed; Tizen 10 fails. Stated in README, helper source not read. arn0-tv and Prism describe the same idea. This corrects our earlier belief that the Home button cannot be rerouted at all: there is a route, unproven on this TV, and it changes a system setting.
2. **Knowing what is in front.** Dylan's launcher polls `webapis.appcommon.getForegroundAppId()` (seen in code). That is a direct answer to "which app is on screen", better than our running-apps poll, and would let the launcher notice Samsung's home even while another app was open.
3. **Titles, not only apps.** AeroTizen reads Samsung's own "continue watching" items from a local endpoint and opens one with an `operation/view` app control carrying a `PAYLOAD` (seen in code, not tested with a public certificate). willysvarela opens titles in Netflix (`m=<id>`), YouTube (`v=<id>`), Prime Video (`gti=<id>`) and Disney+ (whole URL), with ids taken from an unofficial JustWatch query; only Netflix is verified, on one TV.
4. **HDMI.** AeroTizen and Dylan both use `tizen.tvwindow.setSource(…, "MAIN")` with sources from `VIDEOSOURCE`, the route we planned. README-level claims only.
5. **Power-on.** AeroTizen registers at boot as part of its Home route. Dylan's launcher stays alive through standby and relaunches itself on wake. jasimcm confirms the SmartThings rule.
6. **Art Mode.** AeroTizen reads art-mode state from inside the TV over the local art channel and never relaunches while art is showing. Nothing opens Samsung's art picker.

AeroTizen's wiki says hidden web apps are frozen on retail TVs. On this TV ours kept running for two minutes, so that needs a longer test.

## Frame art tools

| Tool | Licence | Fit |
|---|---|---|
| [TheFab21/ha-samsungtv-smart](https://github.com/TheFab21/ha-samsungtv-smart) | badge and sidebar disagree | Best 2025 coverage; mat is per image |
| [NickWaterton/samsung-tv-ws-api](https://github.com/NickWaterton/samsung-tv-ws-api) | LGPL-3.0 | Has a bulk mat example script; fails on this TV's connect order; 2025 "not tested" |
| [MikeO7/frame-tv-art-manager](https://github.com/MikeO7/frame-tv-art-manager) | non-commercial | Global mat only at upload |
| [MaroonedSoftware/curator](https://github.com/MaroonedSoftware/curator) | MIT | Web UI with a mat picker; per image |
| [SpaceCorps/Samsung-Artmode-Cli](https://github.com/SpaceCorps/Samsung-Artmode-Cli) | MIT | Always sends portrait mat `none` |

No tool does a global mat change on a 2025 Frame.

### Worth borrowing

- **Samsung "IP Remote" control** (a TV setting under Expert Settings): switches Art Mode on and off and reports the TV's state from another device. It would let the mat tools put the TV into Art Mode by themselves. Pairing must happen outside Art Mode.
- **Re-select the artwork after a mat change.** Others report the panel does not refresh until the image is selected again, which may explain our stale reading from `get_current_artwork`.
- **Thumbnails:** `get_thumbnail_list` returns an error on 2024 and 2025 firmware, so an art picker of our own would have no pictures to show by that route.
- **Categories:** `MY-C0002` own photos, `MY-C0004` favourites, `MY-C0008` store or recent.
- **Mat pairs can fail** even when style and colour are both in the TV's lists; aspect ratio is the suspected reason.
- Curator's mat picker components are MIT and could be reused for a mat screen.

Nobody documents which of the two mat fields draws the band on a landscape-mounted TV, or anything about art API 5.x.
