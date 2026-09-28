# Changelog

## [v1.0.0] - 2026-09-28

### 📝 Notes

First release of **NyxProps**, the prop-spoofing half of NyxSUSFS, now a module of its own. It does not need SuSFS.

### ✨ Features

* **Presets:** all 21 prop presets from NyxSUSFS v1.0.0, unchanged, with the same rule modes, value tokens, stage and SDK gates, and optional repeat timer.
* **Backends:** stock resetprop by default, or the bundled resetprop-rs for stealth writes and count-preserving deletes.
* **WebUI:** Home shows whether presets were applied this boot and with which backend, the verified boot / bootloader / dm-verity / security patch checks, and counters for props applied and presets enabled. The Props editor, prop settings and appearance options carry over from NyxSUSFS.

### 🛠️ Dev Notes

Presets edited under `/data/adb/nyxsusfs/props` are not imported; copy them into `/data/adb/nyxprops/props` if you want them. Please report any bugs/problems in the GitHub Issues tab.
