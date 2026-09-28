# Tests

Three suites run in CI on every push and pull request (see
`.github/workflows/build.yml`). All of them run on a Linux machine; none
needs a phone.

| Suite | What it checks | Run it |
| --- | --- | --- |
| Boot stages | The three stages of `bin/nyxprops` in 23 device scenarios: every `resetprop` / resetprop-rs / `getprop` / `date` call, every prop it changes and every file a stage writes, plus the repeat loop | `sudo python3 tests/boot/run.py --binary <static host build>` |
| WebUI | Every page, setting write, preset switch, edit, new and delete, theme, fullscreen and resetprop-rs check, plus bridge behaviour and system-bar padding | `npm run test:webui` |
| Installer | `customize.sh` picks the engine for the device's ABI, refuses what it can't run, checks the zip's integrity, sets up resetprop-rs, and keeps or resets settings on an upgrade | `python3 scripts/test-install.py` |

## Boot stages

`tests/boot/run.py` builds a fake Android root for each scenario, installs
`module/` and the binary into it as KernelSU would, and runs
`post-fs-data.sh`, `service.sh` and `boot-completed.sh` in a chroot with a
static busybox. `resetprop`, `getprop` and `date` are stubs that keep a real
property store (one file per prop, with an SELinux context for each name), so
a stage reads back what an earlier one wrote. resetprop-rs is the same stub
under its own flags (`--init`, `--stealth`, `--nuke`).

The scenarios cover the stock, `rs` and `auto` backends (with resetprop-rs
working, missing and broken), every `hide_compact` value and rebuild errors,
SDK gates, a device that needs no changes, a missing `config.sh` or props
directory, odd config values, the `{security_patch}` / `{vendor_patch}` dates
(including the roll-back before the 5th and an unreadable clock), custom
presets with every rule mode and the usual mistakes, failing `resetprop`
calls, and the repeat loop: it must put back a prop that reverts, and stop
when the master switch is turned off.

What each stage did is compared with `tests/boot/expected/<scenario>.json`.
The machine's boot id, the worker's pid and the release version in
`module.prop` are replaced by placeholders, and the repeat loop's calls and
log lines are compared as sets, since how many ticks fit in a wait varies.

It needs root (chroot, mknod, and mounting `/proc` for the repeat
scenarios), a statically linked busybox (Debian/Ubuntu: `busybox-static`) and
a static host build:

```sh
RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target x86_64-unknown-linux-gnu
sudo python3 tests/boot/run.py --binary target/x86_64-unknown-linux-gnu/release/nyxprops
sudo python3 tests/boot/run.py --binary ... rs repeat   # just these scenarios
```

`NYX_BUSYBOX=/path/to/busybox` picks the busybox to use.

## WebUI

`tests/webui/run.cjs` loads the built `module/webroot` in Chromium with a mock
KernelSU manager whose `exec` and `spawn` behave like the real bridge and
run each command for real. The device paths the WebUI reads (`/data/adb`,
`/proc/sys/kernel/random/boot_id`) are moved into a temporary root seeded
from `module/` and `tests/webui/fixtures/` (a boot's `props.log`, a few user
presets, the device's props for `getprop`, and a stand-in for
`bin-update.sh` that answers without downloading), so the run doesn't depend
on the machine and needs no root.

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:webui
NYX_SH=mksh npm run test:webui   # the commands under mksh, as on Android
```

`NYX_CHROMIUM=/path/to/chrome` uses an existing Chromium; `NYX_DEBUG=1` logs
every command; `VERBOSE=1` lists passing checks too.

## Installer

`scripts/test-install.py` runs `customize.sh` under busybox `sh`, as
KernelSU does, against a copy of `module/` with stub engines, stub
resetprop-rs builds and a stub `getevent` for the volume keys. It needs a
busybox (`NYX_BUSYBOX=/path/to/busybox` picks one).

## When a change is intended

Both comparison suites take `--update` to rewrite their expected files:

```sh
sudo python3 tests/boot/run.py --binary ... --update
node tests/webui/run.cjs --update
```

Review the diff of `tests/*/expected/` before committing it: it should show
exactly the behaviour the change was meant to alter.
