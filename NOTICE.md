# NyxProps notices

NyxProps
Copyright (C) 2026 poqdavid

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public
License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program (see `LICENSE`). If not, see
<https://www.gnu.org/licenses/>.

SPDX-License-Identifier: AGPL-3.0-only
Source code: <https://github.com/poqdavid/nyxprops>

## Code NyxProps is derived from

- **NyxSUSFS** by poqdavid, AGPL-3.0
  <https://github.com/poqdavid/nyxsusfs>
  NyxProps is NyxSUSFS' prop-spoofing companion and shares code with it:
  the WebUI core (`webui/src/core/`) is shared between the two, and the
  resetprop-rs updater (`bin-update.sh` and the WebUI side) is adapted from
  NyxSUSFS' susfs binary updater.
- **ksu_module_susfs** by sidex15, AGPL-3.0
  <https://github.com/sidex15/ksu_module_susfs>
  Parts of the installer (`customize.sh`: the reset-settings prompt, the
  download helper and the config merge), the download and connection-check
  helpers in `bin-update.sh`, and the boot-stage setup in `src/` (the
  KernelSU `PATH` and the service stage's wait for boot completion) come
  from this module, by way of NyxSUSFS.

## Ideas and data

- **BRENE** by rrr333nnn333, AGPL-3.0 — <https://github.com/rrr333nnn333/BRENE>:
  the set of props the presets cover follows BRENE's. The preset engine is
  NyxProps' own.

## Bundled third-party files

- The bundled `module/bin/resetprop-<abi>` binaries are **resetprop-rs** by
  Enginex0 (MIT, <https://github.com/Enginex0/resetprop-rs>); see
  `module/LICENSE.resetprop-rs`. They are run as separate programs (the
  default and stealth prop backends), not linked into the engine.
- The `tune` and `close` WebUI icons in `webui/src/core/icons.ts` use path
  geometry from **Material Icons** by Google (Apache License 2.0,
  <https://github.com/google/material-design-icons>); see
  `module/LICENSE.material-icons`.

## Built from source

- `module/bin/nyxprops` is built from the Rust sources in `src/`. It has **no
  third-party crate dependencies** — only the Rust standard library — so no
  additional licenses are bundled on its account.
- `module/webroot/js/app.js` is bundled from the TypeScript sources in
  `webui/src/` by esbuild. TypeScript and esbuild are build tools only; the
  bundle contains no third-party code.
