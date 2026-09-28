# Changelog

## [v1.4.0] - 2026-10-04


### ✨ Features

* **`post-fs-data` preset stage — build-identity props applied before zygote.** Some properties are read once by the Android framework into `android.os.Build` constants when zygote preloads its classes, early in boot. A preset that set them at the `service` stage (after zygote) changed the raw property but not the cached Java value, so a checker comparing the two — e.g. `Build.VERSION.SECURITY_PATCH` vs `ro.build.version.security_patch` — saw them disagree. Presets can now carry `# stage: post-fs-data` to run before zygote, so the Java constant comes up already matching the property. The shipped build-identity presets moved to this stage: **Debuggable / secure** (`ro.debuggable`), **Build type** (`ro.build.type`/`ro.build.tags`), **Security patch level** (`ro.build.version.security_patch`) and **Build fingerprint** (`ro.build.fingerprint`). The Props list and editor show each preset's stage, and the boot log is initialised by whichever stage runs first.
* **Logs tab.** A tab between Settings and About shows this boot's log (`props.log`), newest at the bottom: the backend used, each preset run or skipped, and every prop changed. The last 1,000 lines, with a note when the log is longer. Read the first time you open the tab, so opening the WebUI is no slower; the top-bar refresh re-reads it.
* **resetprop-rs updates from the WebUI.** Settings has an Updates section. **Check resetprop-rs now** compares the bundled binary for your device's ABI against the one on the latest [Enginex0/resetprop-rs](https://github.com/Enginex0/resetprop-rs) release, shows the tag, and offers to install it — it asks first, checks the download actually runs, and swaps it in with a rename. Optionally run the same check in the background each time the WebUI opens (`disable_webui_bin_update=0`); off by default.

### ⚡ WebUI performance

The manager runs each `ksu.exec` in a fresh root shell on the page's main thread, so every read froze the UI. Now:

* **One batched read on open** (was ~13 shell round-trips).
* **Tab switches don't touch the shell** — pages keep what they rendered, and the top-bar refresh re-reads the current page (its icon spins while it does).
* **Stat cards open from the same read their numbers came from.**
* **Paint first** — switches, pickers, the editor, dialogs and refresh update on screen before their shell call runs.
* The **resetprop-rs check runs off-thread** via the manager's `spawn`, scripts load together instead of in waves, and Material You no longer waits up to 1.2 s for a palette on managers that don't serve one.

### 🐛 Fixes

* **Property corruption from the prop-area rebuild.** `hide_compact=area` (the default) ran `resetprop -Z <name> -c` with the property name before `-c`. resetprop stops reading options at the first non-option argument, so `-c` was taken as a *value* and the representative property of each touched area was set to the literal `-c` — seen on device as `ro.board.first_api_level=-c` and `ro.vendor.build.security_patch=-c`. The flags now come first (`resetprop -c -Z <name>`), so the area is rebuilt and nothing is written. A reboot restores any property an earlier build had set to `-c`.
* **Props: saving a preset could undo a toggle.** With a preset's editor open, flipping its switch and then tapping **Save** wrote the enabled state back to what it was before the toggle (the open editor still held the pre-toggle text). Toggling now also updates the open editor, so Save keeps the switch state and any unsaved edits to the rules.
* **Settings could lose changes.** Changing several settings in quick succession (in Settings or the appearance switches on About) could persist only the last one; saves now happen one after another.
* **WebUI double padding with fullscreen off.** On KernelSU, SukiSU-Ultra and ReSukiSU the WebUI opened with an extra gap above the top bar and below the nav bar until fullscreen was toggled off and on. It now turns edge-to-edge back on and owns its insets, as it already did on KernelSU-Next.

### ⚖️ License

* **AGPL-3.0-only, stated consistently** — the `LICENSE` was already AGPL-3.0, but the README said GPL-3.0. Added `NOTICE.md` crediting the projects NyxProps builds on and the licenses of its bundled files (resetprop-rs: MIT; two WebUI icons: Apache-2.0); `LICENSE` and `NOTICE.md` ship inside the zip, and the About screen shows the copyright, license, no-warranty notice and source link.

### 📝 Notes

* **Upgrading:** a build-identity preset you had already enabled and edited is kept as your copy, so it stays on the old `service` stage — add `# stage: post-fs-data` to it (or reset it from the new default in `props/.defaults/`) for the pre-zygote behaviour.
* Build-identity spoofing is only as consistent as the values themselves: a security patch newer than the build fingerprint, or a vendor patch that disagrees, is still a flag, and hardware key attestation (`attestation.osPatchLevel`) is unaffected by any property.
* The resetprop-rs update check compares by hash (any binary that isn't byte-identical reads as different), the binary is only used on the Auto/resetprop-rs backend, and installing a NyxProps update restores that release's bundled build.

## [v1.0.0] - 2026-09-28

### 📝 Notes

First release of **NyxProps**, the prop-spoofing half of NyxSUSFS, now a module of its own. It does not need SuSFS.

### ✨ Features

* **Presets:** all 21 prop presets from NyxSUSFS v1.0.0, unchanged, with the same rule modes, value tokens, stage and SDK gates, and optional repeat timer.
* **Backends:** stock resetprop by default, or the bundled resetprop-rs for stealth writes and count-preserving deletes.
* **WebUI:** Home shows whether presets were applied this boot and with which backend, the verified boot / bootloader / dm-verity / security patch checks, and counters for props applied and presets enabled. The Props editor, prop settings and appearance options carry over from NyxSUSFS.

### 🛠️ Dev Notes

Presets edited under `/data/adb/nyxsusfs/props` are not imported; copy them into `/data/adb/nyxprops/props` if you want them. Please report any bugs/problems in the GitHub Issues tab.
