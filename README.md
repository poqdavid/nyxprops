# NyxProps

[![KernelSU](https://img.shields.io/badge/KernelSU-Supported-green)](https://kernelsu.org/) [![KernelSU-Next](https://img.shields.io/badge/KernelSU--Next-Supported-green)](https://github.com/KernelSU-Next/KernelSU-Next) [![WebUI](https://img.shields.io/badge/WebUI-Material_You-blueviolet)](#-webui) [![Build](https://github.com/poqdavid/nyxprops/actions/workflows/build.yml/badge.svg)](https://github.com/poqdavid/nyxprops/actions/workflows/build.yml) [![Telegram](https://img.shields.io/badge/Join-Support_Chat-blue?logo=telegram&style=flat-square)](https://t.me/poqdavidchat) [![Telegram](https://img.shields.io/badge/Join-Build_Notification-blue?logo=telegram&style=flat-square)](https://t.me/nyxreleases)

Config-driven **device property spoofing** for **KernelSU / KernelSU-Next**, with a **Material You** WebUI. It's the prop-spoofing companion to [NyxSUSFS](https://github.com/poqdavid/nyxsusfs): the two are separate modules, so each can be installed and updated on its own. It does **not** need SuSFS.

---

## ✨ Features

- 🧩 **21 shipped presets** (16 on by default): verified boot state and errors, AVB / vbmeta, warranty bit, debuggable / secure, mock location, build type, OEM unlock, recovery bootmode, ADB state, USB config, vendor-specific props (Xiaomi / Realme), emulator traces, encryption state and the crash-recovery counter, plus opt-in presets for security patch, build date, verified boot hash, build fingerprint and custom ROM props
- 📝 **Plain-text rules**: `missing`, `reset`, `missing_match`, `contains`, `clear`, `delete`, `replace`, `delete_matching` and `same_as`, with `{avb_version}`, `{vbmeta_size}`, `{security_patch}`, `{yyyy_mm}` and `{vendor_patch}` value tokens
- ⏱️ **Stages and gates**: each preset runs at `post-fs-data` (before zygote — for build-identity props the framework caches, like the security patch level, fingerprint and build type), the `service` stage (default; it applies once Android has finished booting, so the system's own boot-time writes can't undo it), or `boot-completed` (KernelSU's boot-completed stage, which starts at that same moment), and can be limited to an Android API range with `min_sdk` / `max_sdk`
- 🔁 **Optional repeat**: a preset with a `# repeat: N` header is re-applied every N seconds, for the rare prop something resets after boot (off for every shipped preset)
- 🥷 **Two backends**: the stock KernelSU/Magisk `resetprop` (default) or the bundled **resetprop-rs** for stealth writes and count-preserving deletes
- ⬆️ **resetprop-rs updates**: compare the installed binary with the latest resetprop-rs release from the WebUI and install it in place, on demand or with an opt-in check when the WebUI opens
- 🧹 **Prop-area rebuild**: after deletions, reclaims the storage holes they leave behind (touched areas, all areas, or off)
- 🎨 **Material You WebUI**: boot status, verification checks, a live list of the props applied this boot, and an in-app preset editor
- 📂 **Own config directory**: presets and settings live under `/data/adb/nyxprops`; your edits survive updates

---

## 📋 Requirements

- **[KernelSU](https://kernelsu.org/)** or **[KernelSU-Next](https://github.com/KernelSU-Next/KernelSU-Next)** installed and working

SuSFS is not required. For path and mount hiding, pair it with **[NyxSUSFS](https://github.com/poqdavid/nyxsusfs)**.

---

## 📥 Installation

1. 📦 Download the latest `nyxprops-*.zip` from the [**Releases**](https://github.com/poqdavid/nyxprops/releases) page
2. 🧩 Open your **KernelSU / KernelSU-Next** manager → **Modules** → **Install from storage**, and select the zip
3. 🔄 **Reboot**
4. ⚙️ Open the module's **WebUI** from the manager to review status and edit presets

---

## 🖥️ WebUI

- **Home**: whether presets were applied this boot and with which backend, verification checks (verified boot state, bootloader, dm-verity, security patch), counters for props applied and presets enabled, and device info. With the update check on, it also shows a notice when a different resetprop-rs build is published
- **Props**: turn presets on or off, edit their rules, create new ones or delete them
- **Settings**: prop backend, prop-area rebuild, the repeat loop master switch, and resetprop-rs updates (check now, or check each time the WebUI opens)
- **Logs**: this boot's log (`props.log`): the backend used, each preset run or skipped, and every prop changed, newest at the bottom
- **About**: appearance (theme, Material You, fullscreen) and credits

Changes to presets and settings take effect on the next reboot.

---

## 🛠️ Built from source

The boot-stage logic is **Rust** (`src/`); the `*.sh` stage files are thin wrappers that `exec` the compiled `bin/nyxprops`, and the prop backends (stock `resetprop` / bundled resetprop-rs) are run as separate programs. The WebUI is **TypeScript** (`webui/src/`), bundled into `module/webroot/js/app.js` with `npm ci && npm run build`. CI builds the per-ABI binaries and the WebUI bundle, so a clone of the repo has source only — both are build products and are git-ignored.

---

## 🧪 Tests

The boot stages, the WebUI and the installer are tested in CI on every push. See [tests/README.md](tests/README.md) to run the tests locally.

---

## 💬 Support

If you encounter any issues or need help, feel free to:

- 🐛 Open an issue in this repository
- 💬 Reach out to me directly

---

## ⚠️ Disclaimer

Changing system properties can confuse apps or the system itself. Please make sure to:

- 💾 Back up your data
- 🧠 Understand the risks before proceeding

**🚨 Proceed at your own risk!**

---

## 📱 Contacts

[![Telegram](https://img.shields.io/badge/Telegram-poqdavid-blue?logo=telegram)](https://t.me/poqdavid)

---

## 🌟 Special Thanks

| 🔧 **Project**        | 👨‍💻 **Developer** | 🔗 **Link**                                              |
| -------------------- | ----------------- | -------------------------------------------------------- |
| **KernelSU**         | tiann             | [GitHub](https://github.com/tiann/KernelSU)              |
| **KernelSU-Next**    | rifsxd            | [GitHub](https://github.com/KernelSU-Next/KernelSU-Next) |
| **Magisk**           | topjohnwu         | [GitHub](https://github.com/topjohnwu/Magisk)            |
| **resetprop-rs**     | Enginex0          | [GitHub](https://github.com/Enginex0/resetprop-rs)       |
| **BRENE**            | rrr333nnn333      | [GitHub](https://github.com/rrr333nnn333/BRENE)          |
| **ksu_module_susfs** | sidex15           | [GitHub](https://github.com/sidex15/ksu_module_susfs)    |

*The set of props the presets cover follows BRENE's. See [NOTICE.md](NOTICE.md) for what comes from where.*

*If you have contributed and are not listed here, please remind me!* 🙏

---

## 📄 License

NyxProps is released under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Bundled third-party files keep their own licenses (resetprop-rs: MIT; two WebUI icons: Apache-2.0); see [NOTICE.md](NOTICE.md).

---

## 💝 Donations

Any and all donations are appreciated!

<br/>**BTC Legacy:** 1Q2JQG3iCLZPT2iJfDLow1oQVGKmxheoAh
<br/>**BTC Segwit:** bc1q8gurls0wjkfe43ygmrqmu2pzmyjetnrvgws9sr
<br/>**BCH:** qrks52smlqw7d8700d77uqvmve03d4knzvd2vghaqz
<br/>**ETH:** 0x7218779242a8425879B09969431c20F5eC1a192D
