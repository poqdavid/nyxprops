# Changelog

## [v1.0.0] - 2026-10-22

First release of **NyxProps**: config-driven device property spoofing for
KernelSU / KernelSU-Next, with a Material You WebUI. It's the prop-spoofing
companion to [NyxSUSFS](https://github.com/poqdavid/nyxsusfs): the two are
separate modules, so each can be installed and updated on its own. It does
not need SuSFS.

### ✨ Presets

* **21 shipped presets, 16 on by default:** verified boot state and errors,
  AVB / vbmeta, warranty bit, debuggable / secure, mock location, build type,
  OEM unlock, recovery bootmode, ADB state, USB config, vendor-specific props
  (Xiaomi / Realme), emulator traces, encryption state and the crash-recovery
  counter, plus opt-in presets for security patch, build date, verified boot
  hash, build fingerprint and custom-ROM props.
* **Plain-text rules:** `missing`, `reset`, `missing_match`, `contains`,
  `clear`, `delete`, `replace`, `delete_matching` and `same_as`.
* **Value tokens:** `{avb_version}`, `{vbmeta_size}`, `{security_patch}`,
  `{yyyy_mm}` (the current month) and `{vendor_patch}`.
* **Patch dates that match the TEE:** `{security_patch}` and `{vendor_patch}`
  follow the patch levels key attestation reports, so the properties and the
  TEE agree. With [Play Integrity Fork](https://github.com/osm0sis/PlayIntegrityFork)
  installed, both are its `SECURITY_PATCH`, read from the config it loads.
  Otherwise, with [TEESimulator](https://github.com/JingMatrix/TEESimulator),
  they are the system and vendor levels of the profile that serves Google
  Play services, resolved as TEESimulator resolves them, or the levels it
  harvested from the real TEE when no profile serves it. Without either, or
  for a level neither gives, the dates come from the clock: `YYYY-MM-01` and
  `YYYY-MM-05`, the 5th stepped back a month until it arrives, so the vendor
  date never runs ahead of the calendar. The log says where each date came
  from and warns when TEESimulator disagrees with Play Integrity Fork. All
  of it is read on-device, with no network.
* **Stages:** each preset runs at `post-fs-data`, `service` (the default) or
  `boot-completed`. `post-fs-data` runs before zygote, which matters for
  build-identity props the framework reads once into `android.os.Build`
  constants: set there, `Build.VERSION.SECURITY_PATCH` and
  `ro.build.version.security_patch` agree. The shipped **Debuggable /
  secure**, **Build type**, **Security patch level** and **Build
  fingerprint** presets run at this stage. The `service` stage waits until
  Android has finished booting, so the system's own boot-time writes can't
  undo its presets; `boot-completed` starts at that same moment, alongside
  it.
* **SDK gates:** `min_sdk` / `max_sdk` limit a preset to an Android API range.
* **Optional repeat:** a `# repeat: N` header re-applies a preset every N
  seconds, for the rare prop something resets after boot. Each preset keeps
  its own interval, clamped to `repeat_min_interval`; a master switch in
  Settings stops the loop without a reboot. On the stock backend, a re-apply
  ends with the same prop-area rebuild as the boot stages. Off for every
  shipped preset.

### ✨ Backends

* **Stock `resetprop`** (KernelSU / Magisk) by default, or the bundled
  **resetprop-rs** for stealth writes (`ro.*` via `--init`) and
  count-preserving deletes (`--nuke`). `auto` uses resetprop-rs when a
  working binary is present and falls back to stock otherwise. Both are run
  as separate programs, not linked into the engine.
* **Prop-area rebuild** (`hide_compact`): after the presets run on the stock
  backend, reclaim the holes deleted props leave behind — in the areas
  NyxProps touched (default), in every area, or not at all.
* **resetprop-rs updates from the WebUI:** compare the installed binary for
  the device's ABI with the latest
  [Enginex0/resetprop-rs](https://github.com/Enginex0/resetprop-rs) release
  and install it in place. It asks first, checks the download actually runs,
  and swaps it in with a rename. Run it from Settings, or opt in to a check
  each time the WebUI opens (`disable_webui_bin_update=0`).

### ✨ WebUI

* **Home:** whether presets were applied this boot and with which backend,
  verification checks (verified boot state, bootloader, dm-verity, security
  patch), counters for props applied and presets enabled, and device info.
* **Props:** turn presets on or off, edit their rules, create new ones from a
  documented template, or delete them. Each preset shows its stage and SDK
  gate.
* **Settings:** prop backend, prop-area rebuild, the repeat master switch and
  resetprop-rs updates.
* **Logs:** this boot's `props.log` — the backend used, each preset run or
  skipped, every prop changed and any write that failed — newest at the
  bottom.
* **About:** theme, Material You, fullscreen, credits and license.
* **Light on the manager:** one bundled script, one batched read on open,
  tab switches that don't touch the shell, and switches, dialogs and the
  editor that update on screen before their shell call runs.

### ⚙️ Engine and install

* The boot stages are a static **Rust** binary, `bin/nyxprops`, built for
  arm64-v8a, armeabi-v7a, x86 and x86_64. The installer keeps the build for
  the device and drops the rest. If the binary can't run, the stage logs one
  line and exits cleanly — never a bootloop.
* A per-file SHA-256 integrity check runs at install time.
* Presets and settings live in `/data/adb/nyxprops` and survive updates. A
  preset you've edited is kept as yours; the shipped default is saved next to
  it in `props/.defaults/`.

### 🛠️ Development

* The engine is Rust (`src/`) with no third-party crates — standard library
  only. The WebUI is strict TypeScript (`webui/src/`), bundled by esbuild into
  `module/webroot/js/app.js`; CI runs `npm ci`, `npm run typecheck` and
  `npm run build`.
* `webui/src/core/` (manager bridge, theme, language, fullscreen, keyboard,
  sheet, dialog, icons) is a folder shared with NyxSUSFS and NyxBridge.

### ⚖️ License

* **AGPL-3.0-only.** `LICENSE` and `NOTICE.md` ship inside the zip, and the
  About screen shows the copyright, license, no-warranty notice and source
  link. `NOTICE.md` credits the projects NyxProps builds on and the licenses
  of its bundled files (resetprop-rs: MIT; two WebUI icons: Apache-2.0).

### 📝 Notes

* Changes to presets and settings take effect on the next reboot.
* The security patch preset changes the **properties**, never the TEE.
  Key attestation's `osPatchLevel` / `vendorPatchLevel` come from the TEE or
  a keystore spoofer, which is why the dates follow Play Integrity Fork and
  TEESimulator. With another spoofer (TrickyStore, OhMyKeymint) pinned to a
  fixed date, match it by editing the preset's values.
* Build-identity spoofing is only as consistent as the values: a security
  patch newer than the build fingerprint, or a vendor patch that disagrees,
  is still a flag.
* The resetprop-rs update check compares by hash, so any binary that isn't
  byte-identical reads as different. Installing a NyxProps update restores
  that release's bundled build.

Please report any bugs or problems in the GitHub Issues tab.
