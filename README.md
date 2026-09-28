# NyxProps

[![KernelSU](https://img.shields.io/badge/KernelSU-Supported-green)](https://kernelsu.org/) [![KernelSU-Next](https://img.shields.io/badge/KernelSU--Next-Supported-green)](https://github.com/KernelSU-Next/KernelSU-Next) [![WebUI](https://img.shields.io/badge/WebUI-Material_You-blueviolet)](#-webui) [![Build](https://github.com/poqdavid/nyxprops/actions/workflows/build.yml/badge.svg)](https://github.com/poqdavid/nyxprops/actions/workflows/build.yml) [![Telegram](https://img.shields.io/badge/Join-Support_Chat-blue?logo=telegram&style=flat-square)](https://t.me/poqdavidchat) [![Telegram](https://img.shields.io/badge/Join-Build_Notification-blue?logo=telegram&style=flat-square)](https://t.me/nyxreleases)

Config-driven **device property spoofing** for **KernelSU / KernelSU-Next**, with a **Material You** WebUI. NyxProps is the prop-spoofing half of [NyxSUSFS](https://github.com/poqdavid/nyxsusfs), split out so it can be installed, updated and switched off on its own. It does **not** need SuSFS.

---

## ✨ Features

- 🧩 **21 shipped presets** (16 on by default): verified boot state and errors, AVB / vbmeta, warranty bit, debuggable / secure, mock location, build type, OEM unlock, recovery bootmode, ADB state, USB config, vendor-specific props (Xiaomi / Realme), emulator traces, encryption state and the crash-recovery counter, plus opt-in presets for security patch, build date, verified boot hash, build fingerprint and custom ROM props
- 📝 **Plain-text rules**: `missing`, `reset`, `missing_match`, `contains`, `clear`, `delete`, `replace`, `delete_matching` and `same_as`, with `{avb_version}`, `{vbmeta_size}`, `{security_patch}` and `{yyyy_mm}` value tokens
- ⏱️ **Stages and gates**: each preset runs at the service stage (default) or at boot-completed, and can be limited to an Android API range with `min_sdk` / `max_sdk`
- 🔁 **Optional repeat**: a preset with a `# repeat: N` header is re-applied every N seconds, for the rare prop something resets after boot (off for every shipped preset)
- 🥷 **Two backends**: the stock KernelSU/Magisk `resetprop` (default) or the bundled **resetprop-rs** for stealth writes and count-preserving deletes
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

> [!NOTE]
> Coming from **NyxSUSFS v1.0.0 or older**? NyxSUSFS v1.1.0+ no longer applies props, so install NyxProps to keep prop spoofing. Presets you edited under `/data/adb/nyxsusfs/props` are not imported automatically; copy them into `/data/adb/nyxprops/props` if you want them back.

---

## 🖥️ WebUI

- **Home**: whether presets were applied this boot and with which backend, verification checks (verified boot state, bootloader, dm-verity, security patch), counters for props applied and presets enabled, and device info
- **Props**: turn presets on or off, edit their rules, create new ones or delete them
- **Settings**: prop backend, prop-area rebuild and the repeat loop master switch
- **About**: appearance (theme, Material You, fullscreen) and credits

Changes to presets and settings take effect on the next reboot.

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
