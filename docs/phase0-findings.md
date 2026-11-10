# Phase 0 findings

What has actually been observed on the TV. Anything not listed here is still unverified.

## 2026-11-10

**Confirmed**

- The TV's own info page reports model `TQ65LS03FWUXXC` (`25_RSM_FTV`), OS Tizen, Frame support, wireless network.
- Developer Mode switches on with the 12345 code. The TV accepts the developer connection only from the Host PC IP stored in it: with the wrong address the port was open but `sdb connect` failed; after correcting it and a restart, `sdb devices` listed the TV.
- Over the developer connection the TV reports `platform_version:9.0`, `profile_name:tv`, `cpu_arch:armv7`, `sdbd_version:2.2.31`. Reading the DUID works (`sdb shell 0 getduid`).
- Pairing with the TV's controls works (`tools/frame/pair.py` returned a token after Allow on the TV).
- Tizen Studio 6.1 command-line tools and Certificate Manager start under Rosetta on macOS 27.

**Not working yet**

- Art controls: the TV says art is supported, but every art request timed out (`get_api_version`, `get_artmode_status`, image list, mat list, settings). Tested with the TV on its home screen, with both `tools/frame/check.py` and the library's own diagnostic. Next test: the same requests while the TV is in Art Mode.
- Certificate Manager's wizard ignores background clicks on its Next button (clicks on the first two screens worked). It needs real clicks at the Mac.

**Not tested yet**

- Certificate creation, packaging, installing and running the probe app.
- Everything the probe measures, the power-cycle survival check, and the SmartThings power-on rule.
