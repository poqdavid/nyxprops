# Changelog

## [v1.3.2] - 2026-10-04

### 🐛 Fixes

* **Props: saving a preset could undo a toggle you just made.** With a preset's editor open, flipping its enable/disable switch and then tapping **Save** wrote the enabled state back to what it was before the toggle. The editor loads the preset's text once, and the switch rewrites only the file's `# enabled:` line, so the open editor still held the old header and Save wrote it back over the toggle. Toggling now also updates the open editor's text, so Save keeps the switch state (and any unsaved edits to the rules).

## [v1.3.1] - 2026-10-04

### 🐛 Fixes

* **Property corruption from the prop-area rebuild (wrong argument order).** The per-area step of "rebuild prop areas after changes" (`hide_compact=area`, the default) ran `resetprop -Z <name> -c` — with the property name *before* `-c`. resetprop stops reading options at the first non-option argument, so `-c` was taken as a *value* rather than the `--rebuild` flag, and the representative property of each touched area was set to the literal `-c`. On device this showed up as `ro.board.first_api_level=-c` and `ro.vendor.build.security_patch=-c` (and matching detector hits), and it silently hit one property in every touched area on every boot. The flags now come before the name (`resetprop -c -Z <name>`), so the area is rebuilt as intended and nothing is written. A reboot restores any property an earlier build had set to `-c`.

## [v1.3.0] - 2026-10-01

### ✨ WebUI

* **Logs tab.** A new tab between Settings and About shows this boot's log (`props.log`), newest at the bottom: the backend NyxProps used, each preset it ran or skipped, and every prop it changed. It shows the last 1,000 lines, with a note when the log is longer. The log is read the first time you open the tab, so opening the WebUI is no slower; the refresh button in the top bar re-reads it.

## [v1.2.0] - 2026-09-28

### ⚡ WebUI performance

The manager's `ksu.exec` holds the WebUI's main thread while it opens a fresh root shell for each command, so every shell read froze the page. Opening the WebUI took 13 of them, and every switch back to Home took 11, all before the tab even changed on screen.

* **One read on open.** Everything the four pages show, plus the night-mode check for the "System" theme, is now read through a single root shell. It used to take 13.
* **Instant tab switches.** Pages keep what they show instead of re-reading on every visit. The refresh button in the top bar re-reads the page you're on, and its icon spins while it does. Toggling, editing, creating or deleting a preset has Home re-read its counts on your next visit.
* **Stat cards** on Home, and the applied-props card on Props, open their list straight away, from the same read the numbers came from.
* **Paint first.** Switches, pickers, the preset editor, dialogs and the refresh button update on screen before their shell call runs.
* **resetprop-rs update check** (on open and "Check") now runs in the background through the manager's `spawn`, so the WebUI stays usable while it waits on the network. Managers without `spawn` use the previous blocking call.
* **Faster loading:** the WebUI's scripts load together instead of one wave of imports at a time, and the language files load in parallel.
* **Material You:** with it turned on, opening the WebUI no longer waits up to 1.2 s for a palette on managers that don't serve one.

### 🐛 Fixes

* **Settings could lose changes.** Changing several settings in quick succession (in Settings or the appearance switches on About) could write only the last one to `config.sh`, even though every control showed as changed. Saves now happen one after another.

## [v1.1.0] - 2026-09-28

### ✨ Features

* **resetprop-rs updates from the WebUI.** Settings has a new Updates section. **Check resetprop-rs now** compares the module's resetprop-rs binary for your device's ABI with the one attached to the latest [Enginex0/resetprop-rs](https://github.com/Enginex0/resetprop-rs) release, shows the latest release tag, and offers to install it. Installing asks first, checks that the download runs (`-h`) before replacing anything, and swaps the new binary in with a rename. A reboot applies it.
* **Optional check when the WebUI opens.** Turn off **Skip resetprop-rs update check on open** (`disable_webui_bin_update=0`) and the WebUI runs the same check in the background each time it opens. It only speaks up, with a notice on Home, when there is something to install. Off by default.

### 📝 Notes

* The comparison is by hash, so any binary that isn't byte-identical to the published one is reported as different, not as older.
* The binary is only used when the prop backend is Auto or resetprop-rs. Updating it with the stock resetprop selected is allowed, and the confirmation says it won't be used until you switch.
* Installing a NyxProps update puts back the resetprop-rs build bundled with that release.

## [v1.0.2] - 2026-09-28

### 🐛 Fixes

* **WebUI double padding with fullscreen off.** On KernelSU, SukiSU-Ultra and ReSukiSU, the WebUI opened with an extra gap above the top bar and below the navigation bar. It only went away after toggling fullscreen on and off. These managers turn edge-to-edge off whenever fullscreen is turned off, so the manager and the WebUI both padded for the system bars. The WebUI now turns edge-to-edge back on and handles the bars itself, as it already did on KernelSU-Next.

## [v1.0.1] - 2026-09-28

### ⚖️ License

* **AGPL-3.0-only, stated consistently.** `LICENSE` was already the AGPL-3.0 text, but the README said GPL-3.0; it now says AGPL-3.0-only.
* **Notices:** added `NOTICE.md`, which credits the projects NyxProps builds on and the licenses of its bundled files (resetprop-rs: MIT; two WebUI icons: Apache-2.0). `LICENSE` and `NOTICE.md` now ship inside the module zip.
* **About screen:** now shows the copyright, the license, the no-warranty notice and where to find the source.

## [v1.0.0] - 2026-09-28

### 📝 Notes

First release of **NyxProps**, the prop-spoofing half of NyxSUSFS, now a module of its own. It does not need SuSFS.

### ✨ Features

* **Presets:** all 21 prop presets from NyxSUSFS v1.0.0, unchanged, with the same rule modes, value tokens, stage and SDK gates, and optional repeat timer.
* **Backends:** stock resetprop by default, or the bundled resetprop-rs for stealth writes and count-preserving deletes.
* **WebUI:** Home shows whether presets were applied this boot and with which backend, the verified boot / bootloader / dm-verity / security patch checks, and counters for props applied and presets enabled. The Props editor, prop settings and appearance options carry over from NyxSUSFS.

### 🛠️ Dev Notes

Presets edited under `/data/adb/nyxsusfs/props` are not imported; copy them into `/data/adb/nyxprops/props` if you want them. Please report any bugs/problems in the GitHub Issues tab.
