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
  NyxProps was split out of NyxSUSFS v1.0.0. Its prop engine, presets and
  WebUI come from there.
- **ksu_module_susfs** by sidex15, AGPL-3.0
  <https://github.com/sidex15/ksu_module_susfs>
  Parts of the installer (`customize.sh`: the reset-settings prompt, the
  download helper and the config merge) and the preamble of the boot scripts
  come from this module, by way of NyxSUSFS.

## Ideas and data

- **BRENE** by rrr333nnn333, AGPL-3.0 — <https://github.com/rrr333nnn333/BRENE>:
  the set of props the presets cover follows BRENE's. The preset engine is
  NyxProps' own.

## Bundled third-party files

- `module/bin/resetprop-arm64-v8a` and `module/bin/resetprop-armeabi-v7a`:
  **resetprop-rs** by Enginex0 (MIT, <https://github.com/Enginex0/resetprop-rs>);
  see `module/LICENSE.resetprop-rs`.
- The `tune` and `close` WebUI icons in `module/webroot/js/icons.js` use path
  geometry from **Material Icons** by Google (Apache License 2.0,
  <https://github.com/google/material-design-icons>); see
  `module/LICENSE.material-icons`.
