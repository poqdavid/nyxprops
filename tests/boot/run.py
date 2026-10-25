#!/usr/bin/env python3
"""Boot-stage tests for bin/nyxprops.

Builds a fake Android root per scenario, installs the module and the given
binary into it, runs the three stage scripts in order inside a chroot with a
static busybox, and records what each stage did:

  * every call to an external tool (resetprop, resetprop-rs, getprop, date) -
    through stubs that keep a real property store, with SELinux contexts, so
    reads see earlier writes,
  * how the property store changed,
  * the files a stage writes (props.log, module.prop, the repeat loop's pid
    files) with mode and owner.

The repeat scenarios also drive the background loop: a property is reverted
and must be put back, then the master switch must stop the loop.

The result is compared with tests/boot/expected/<scenario>.json. Run with
--update to rewrite those files after an intended change, and review the diff.

usage: sudo python3 tests/boot/run.py --binary PATH [--update] [scenario ...]

Needs root (chroot, mknod, mounting /proc for the repeat scenarios), chroot(8)
and a statically linked busybox (NYX_BUSYBOX=/path picks one), and a static
host build of the binary, e.g.
  RUSTFLAGS="-C target-feature=+crt-static" cargo build --release --target x86_64-unknown-linux-gnu
"""
import argparse
import difflib
import json
import os
import re
import shutil
import stat as st
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
EXPECTED = os.path.join(HERE, "expected")
STAGES = ["post-fs-data", "service", "boot-completed"]
MOD = "/data/adb/modules/nyxprops"
PDIR = "/data/adb/nyxprops"
TMP = "/data/adb/ksu/nyxprops"
BOOT_ID = "0f0e0d0c-0b0a-4908-8706-050403020100"
WORK = None
BUSYBOX = None
CHROOT = None

# The property store: one file per property under /fixture/props, the value
# as its content. Contexts come from the name, like property_contexts.
STORE = r'''
__nyx_log() {
    _l="$1"; shift; for _a in "$@"; do _l="$_l [$_a]"; done
    # Calls from the repeat worker (bin/nyxprops __repeat) are told apart:
    # it runs alongside the stages.
    case "$(tr '\0' ' ' < /proc/$PPID/cmdline 2> /dev/null)" in *__repeat*) _l="repeat: $_l" ;; esac
    printf '%s\n' "$_l" >> /calls.log
}
__nyx_fail() { [ -f /fixture/fail ] && grep -qxF "$*" /fixture/fail; }
__nyx_ctx() {
    case "$1" in
    ro.boot.* | vendor.boot.*) echo u:object_r:bootloader_prop:s0 ;;
    ro.build.* | ro.*.build.* | persist.vendor.build.*) echo u:object_r:build_prop:s0 ;;
    ro.debuggable | ro.force.debuggable | ro.secure | ro.adb.secure | ro.allow.mock.location) echo u:object_r:userdebug_or_eng_prop:s0 ;;
    init.svc.* | init.svc_debug_pid.*) echo u:object_r:init_service_status_prop:s0 ;;
    service.adb.* | persist.sys.usb.* | sys.usb.*) echo u:object_r:usb_control_prop:s0 ;;
    ro.crypto.* | ro.kernel.*) echo u:object_r:vold_prop:s0 ;;
    ro.*) echo u:object_r:vendor_default_prop:s0 ;;
    *) echo u:object_r:system_prop:s0 ;;
    esac
}
__nyx_get() { [ -f "/fixture/props/$1" ] && cat "/fixture/props/$1"; return 0; }
__nyx_set() { printf '%s' "$2" > "/fixture/props/$1"; }
__nyx_dump() { for _p in $(ls /fixture/props | sort); do printf '[%s]: [%s]\n' "$_p" "$(cat "/fixture/props/$_p")"; done; }
__nyx_dumpctx() { for _p in $(ls /fixture/props | sort); do printf '[%s]: [%s]\n' "$_p" "$(__nyx_ctx "$_p")"; done; }
'''

MOCKS = {
    # KernelSU's resetprop (Magisk's): -n set, -d delete, -Z contexts,
    # -c rebuild, -w wait.
    "resetprop": STORE + r'''
__nyx_log resetprop "$@"
__nyx_fail "resetprop $*" && { echo "resetprop: mock failure" >&2; exit 1; }
case "$1" in
"") __nyx_dump ;;
-w) ;;
-n) __nyx_set "$2" "$3" ;;
-d) rm -f "/fixture/props/$2" ;;
-Z) if [ -n "$2" ]; then __nyx_ctx "$2"; else __nyx_dumpctx; fi ;;
-c)
    if [ -f /fixture/rebuild_error ]; then cat /fixture/rebuild_error; fi ;;
*) __nyx_get "$1" ;;
esac
exit 0
''',
    "getprop": STORE + r'''
__nyx_log getprop "$@"
if [ -z "$1" ]; then __nyx_dump; else __nyx_get "$1"; fi
exit 0
''',
    "date": STORE + r'''
__nyx_log date "$@"
cat /fixture/date
''',
}

# resetprop-rs, bundled in the module's bin/ for the device's ABI.
RS_MOCK = STORE + r'''
__nyx_log resetprop-rs "$@"
__nyx_fail "resetprop-rs $*" && exit 1
case "$1" in
-h) echo "resetprop-rs (mock)" ;;
"") __nyx_dump ;;
--init | --stealth) __nyx_set "$2" "$3" ;;
--nuke) rm -f "/fixture/props/$2" ;;
-Z) __nyx_ctx "$2" ;;
*) __nyx_get "$1" ;;
esac
exit 0
'''

# A rooted device with every red flag the shipped presets look for.
DEVICE = {
    "ro.product.cpu.abi": "arm64-v8a",
    "ro.build.version.sdk": "34",
    "ro.boot.avb_version": "1.3",
    "ro.boot.vbmeta.device_state": "unlocked",
    "vendor.boot.vbmeta.device_state": "unlocked",
    "ro.boot.verifiedbootstate": "orange",
    "ro.boot.flash.locked": "0",
    "ro.boot.veritymode": "eio",
    "vendor.boot.verifiedbootstate": "orange",
    "ro.is_ever_orange": "1",
    "ro.boot.verifiedbooterror": "vbmeta_unlocked",
    "vendor.boot.verifyerrorpart": "boot",
    "ro.boot.warranty_bit": "1",
    "ro.warranty_bit": "1",
    "ro.vendor.warranty_bit": "1",
    "ro.debuggable": "1",
    "ro.secure": "0",
    "ro.adb.secure": "0",
    "ro.allow.mock.location": "1",
    "ro.build.type": "userdebug",
    "ro.build.tags": "test-keys",
    "ro.build.version.security_patch": "2024-01-01",
    "ro.vendor.build.security_patch": "2024-01-05",
    "sys.oem_unlock_allowed": "1",
    "ro.secureboot.lockstate": "unlocked",
    "ro.boot.realmebootstate": "orange",
    "ro.bootmode": "recovery",
    "ro.boot.bootmode": "normal",
    "vendor.boot.bootmode": "recovery_mode",
    "init.svc.adbd": "running",
    "init.svc_debug_pid.adbd": "1234",
    "service.adb.root": "1",
    "service.adb.tcp.port": "5555",
    "persist.sys.usb.config": "mtp,adb",
    "sys.usb.config": "mtp,adb",
    "ro.kernel.qemu": "1",
    "ro.crypto.state": "unencrypted",
    "crashrecovery.rescue_boot_count": "2",
    "ro.build.fingerprint": "lineage/a15/a15:15/AP3A/eng.user:userdebug/test-keys",
    "ro.build.date.utc": "1730000000",
    "ro.build.date": "Sun Oct 27 03:33:20 UTC 2024",
    "ro.vendor.build.date.utc": "1700000000",
    "ro.system.build.date": "Tue Nov 14 22:13:20 UTC 2023",
    "ro.modversion": "lineage-22.1",
    "ro.lineage.version": "22.1",
    "ro.lineage.build.version": "22.1",
    "ro.crdroid.version": "11",
    "sys.boot_completed": "1",
    "ro.boot.hardware": "mt6789",
}

# The same device after the default presets: nothing left to change.
CLEAN = {**DEVICE, **{
    "ro.boot.vbmeta.invalidate_on_error": "yes", "ro.boot.vbmeta.avb_version": "1.3", "ro.boot.vbmeta.hash_alg": "sha256",
    "ro.boot.vbmeta.size": "13696", "ro.boot.vbmeta.device_state": "locked", "vendor.boot.vbmeta.device_state": "locked",
    "ro.boot.verifiedbootstate": "green", "ro.boot.flash.locked": "1", "ro.boot.veritymode": "enforcing",
    "vendor.boot.verifiedbootstate": "green", "ro.is_ever_orange": "0", "ro.boot.warranty_bit": "0", "ro.warranty_bit": "0",
    "ro.vendor.warranty_bit": "0", "ro.debuggable": "0", "ro.secure": "1", "ro.adb.secure": "1", "ro.allow.mock.location": "0",
    "ro.build.type": "user", "ro.build.tags": "release-keys", "sys.oem_unlock_allowed": "0", "ro.secureboot.lockstate": "locked",
    "ro.boot.realmebootstate": "green", "ro.bootmode": "unknown", "vendor.boot.bootmode": "unknown", "init.svc.adbd": "stopped",
    "init.svc_debug_pid.adbd": "", "persist.sys.usb.config": "mtp", "ro.kernel.qemu": "", "ro.crypto.state": "encrypted",
}}
for _gone in ["ro.boot.verifiedbooterror", "vendor.boot.verifyerrorpart", "service.adb.root", "service.adb.tcp.port", "crashrecovery.rescue_boot_count"]:
    CLEAN.pop(_gone)

OPT_IN = ["52-security-patch.prop", "53-build-date.prop", "54-verified-boot-hash.prop", "97-fingerprint.prop", "98-rom-props.prop"]

# Presets a user might write, including mistakes.
CUSTOM = {
    "70-modes.prop": (
        "# name: Every mode\n# description: one rule of each kind\n# enabled: 1\n\n"
        "missing        ro.test.missing      created\n"
        "missing        ro.boot.hardware     never-overwritten\n"
        "reset          ro.test.absent       never-created\n"
        "missing_match  ro.test.mm           value with spaces\n"
        "contains       ro.build.fingerprint userdebug  whole/new/value\n"
        "contains       ro.bootmode          nomatch    unchanged\n"
        "clear          ro.lineage.build.version\n"
        "clear          ro.test.absent2\n"
        "delete         ro.crdroid.version\n"
        "delete         ro.test.absent3\n"
        "replace        ro.system.build.date UTC  GMT\n"
        "replace        ro.system.build.date 2023\n"
        "same_as        ro.vendor.build.date.utc ro.build.date.utc\n"
        "same_as        ro.test.notthere     ro.build.date.utc\n"
        "delete_matching ^ro\\.test\\.(mm|missing)$\n"
    ),
    "71-mistakes.prop": (
        "# name: Mistakes\n# enabled: 1\n\n"
        "frobnicate ro.x 1\n"
        "reset\n"
        "contains ro.x onlyneedle\n"
        "replace ro.x\n"
        "replace ro.x \"\" y\n"
        "same_as ro.x\n"
        "   # an indented comment\n"
        "reset ro.build.type   user   # a trailing comment is a value word\n"
    ),
    "72-template-style.prop": (
        "# name: From the template\n# description: headers below the blank line are documentation\n# enabled: 1\n\n"
        "# Optional headers:\n#   stage: post-fs-data     run BEFORE zygote.\n#   min_sdk: 36\n#   max_sdk: 35\n"
        "#   repeat: 5\n\nreset ro.secureboot.lockstate locked-by-template\n"
    ),
    "73-off-below.prop": "# name: Enabled line below the block\n\nreset ro.boot.realmebootstate yellow\n# enabled: 0\n",
    "74-gated.prop": "# name: Gated\n# min_sdk: 30\n# max_sdk: 33\n\nreset ro.warranty_bit gated\n",
    "75-comments-only.prop": "# name: Nothing to do\n# enabled: 1\n",
    "76-disabled.prop": "# name: Off\n# enabled: 0\n\nreset ro.debuggable 7\n",
    "77-tokens.prop": (
        "# name: Tokens\n# stage: boot-completed\n\n"
        "missing ro.test.sp {security_patch}\nmissing ro.test.ym {yyyy_mm}\nmissing ro.test.vp {vendor_patch}\n"
        "missing ro.test.avb {avb_version}\nmissing ro.test.vb {vbmeta_size}\nmissing ro.test.unknown {not_a_token}\n"
    ),
}

REPEAT_PRESET = "# name: Repeat\n# enabled: 1\n# repeat: 1\n\nreset ro.allow.mock.location 0\n"

# name -> dict(config overrides, presets to enable/disable/add, device props, fixture tweaks)
SCENARIOS = {
    "default": {},
    "allon": {"enable": OPT_IN},
    "rs": {"config": {"prop_tool": "'rs'"}, "enable": OPT_IN, "rs": True},
    "rs-missing": {"config": {"prop_tool": "'rs'"}},
    "auto-without-rs": {"config": {"prop_tool": "'auto'"}},
    "auto-with-rs": {"config": {"prop_tool": "'auto'"}, "rs": True},
    "rs-broken": {"config": {"prop_tool": "'auto'"}, "rs": "broken"},
    "sdk36": {"props": {"ro.build.version.sdk": "36"}},
    "sdk-unknown": {"props": {"ro.build.version.sdk": "abc"}},
    "global-rebuild": {"config": {"hide_compact": "'global'"}},
    "no-rebuild": {"config": {"hide_compact": "'off'"}},
    "rebuild-error": {"rebuild_error": "resetprop: failed to rebuild u:object_r:radio_prop:s0: area corrupted\n"},
    "rebuild-error-global": {"config": {"hide_compact": "'global'"}, "rebuild_error": "resetprop: u:object_r:radio_prop:s0 corrupted, skipped\n"},
    "clean-device": {"device": CLEAN},
    "no-config": {"config": None},
    "no-props-dir": {"presets": False},
    "odd-values": {"config": {"prop_tool": "'bogus'", "hide_compact": "'sometimes'", "avb_version": "'1.2'", "vbmeta_size": None}},
    "date-rollback": {"enable": ["52-security-patch.prop"], "date": "2026-01-03"},
    "bad-clock": {"enable": ["52-security-patch.prop"], "date": "not a date"},
    "custom-presets": {"add": CUSTOM},
    "failures": {"fail": ["resetprop -n ro.secure 1", "resetprop -d ro.boot.verifiedbooterror", "resetprop -n ro.crypto.state encrypted"]},
    "repeat": {"config": {"repeat_min_interval": "1"}, "add": {"45-repeat.prop": REPEAT_PRESET}, "repeat": True},
    "repeat-off": {"config": {"repeat_enabled": "0", "repeat_min_interval": "1"}, "add": {"45-repeat.prop": REPEAT_PRESET}},
}


def write(path, content, mode=0o644, uid=0, gid=0):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    os.chmod(path, mode)
    os.chown(path, uid, gid)


def mkdir(path, mode=0o755):
    os.makedirs(path, exist_ok=True)
    os.chmod(path, mode)


def apply_config(base_text, overrides):
    lines = base_text.split("\n")
    for key, val in overrides.items():
        idx = next((i for i, l in enumerate(lines) if l.startswith(f"{key}=")), None)
        if val is None:
            if idx is not None:
                del lines[idx]
        elif idx is not None:
            lines[idx] = f"{key}={val}"
        else:
            lines.insert(len(lines) - 1 if lines and lines[-1] == "" else len(lines), f"{key}={val}")
    return "\n".join(lines)


def set_enabled(text, on):
    return re.sub(r"^# enabled: \d", f"# enabled: {1 if on else 0}", text, count=1, flags=re.M)


def build_root(root, module_dir, binary, sc):
    assert root.startswith(WORK + "/"), root
    if os.path.exists(root):
        shutil.rmtree(root)
    # /bin: busybox and its applets.
    mkdir(f"{root}/bin")
    shutil.copy2(BUSYBOX, f"{root}/bin/busybox")
    for a in subprocess.run([BUSYBOX, "--list"], capture_output=True, text=True).stdout.split():
        if a != "busybox":
            os.symlink("busybox", f"{root}/bin/{a}")
    mkdir(f"{root}/dev")
    os.mknod(f"{root}/dev/null", 0o666 | st.S_IFCHR, os.makedev(1, 3))
    os.chmod(f"{root}/dev/null", 0o666)
    mkdir(f"{root}/tmp", 0o1777)
    mkdir(f"{root}/proc")
    write(f"{root}/calls.log", "")
    # KernelSU's bin dir, first in the engine's PATH: the stubs.
    for name, body in MOCKS.items():
        write(f"{root}/data/adb/ksu/bin/{name}", "#!/bin/sh\n" + body, 0o755)
    # The module as installed: customize.sh has picked the engine, the WebUI
    # and installer files don't take part in boot.
    mod = root + MOD
    shutil.copytree(module_dir, mod, symlinks=True,
                    ignore=shutil.ignore_patterns("*.sha256", "LICENSE*", "NOTICE.md", "webroot", "bin", "props", "customize.sh", "verify.sh", "config.sh"))
    mkdir(f"{mod}/bin")
    shutil.copy2(binary, f"{mod}/bin/nyxprops")
    if sc.get("rs"):
        write(f"{mod}/bin/resetprop-arm64-v8a", "#!/bin/sh\n" + (RS_MOCK if sc["rs"] is True else "exit 1\n"), 0o755)
    # KernelSU's installer: set_perm_recursive $MODPATH 0 0 0755 0644, then
    # customize.sh makes bin/nyxprops executable.
    for dirpath, _dirs, fnames in os.walk(mod):
        os.chmod(dirpath, 0o755)
        for f in fnames:
            os.chmod(os.path.join(dirpath, f), 0o755 if "/bin/" in os.path.join(dirpath, f) else 0o644)
    # Persistent config and presets, as customize.sh leaves them.
    cfg = sc.get("config", {})
    if cfg is not None:
        base = open(os.path.join(module_dir, "config.sh")).read() + "vbmeta_size=13696\n"
        write(f"{root}{PDIR}/config.sh", apply_config(base, cfg))
    else:
        mkdir(f"{root}{PDIR}")
    if sc.get("presets", True):
        for f in sorted(os.listdir(os.path.join(module_dir, "props"))):
            text = open(os.path.join(module_dir, "props", f)).read()
            if f in sc.get("enable", []):
                text = set_enabled(text, True)
            write(f"{root}{PDIR}/props/{f}", text)
            write(f"{root}{PDIR}/props/.defaults/{f}", text)
        for f, text in sc.get("add", {}).items():
            write(f"{root}{PDIR}/props/{f}", text)
    mkdir(f"{root}{TMP}")
    # The device.
    fx = f"{root}/fixture"
    mkdir(f"{fx}/props")
    for k, v in {**sc.get("device", DEVICE), **sc.get("props", {})}.items():
        write(f"{fx}/props/{k}", v)
    write(f"{fx}/date", sc.get("date", "2026-10-22") + "\n")
    if sc.get("fail"):
        write(f"{fx}/fail", "\n".join(sc["fail"]) + "\n")
    if sc.get("rebuild_error"):
        write(f"{fx}/rebuild_error", sc["rebuild_error"])
    if not sc.get("repeat"):
        write(f"{root}/proc/sys/kernel/random/boot_id", BOOT_ID + "\n")


def props_of(root):
    d = f"{root}/fixture/props"
    return {n: open(os.path.join(d, n)).read() for n in sorted(os.listdir(d))}


def normalizer():
    """The repeat scenarios run with the machine's /proc mounted, so its boot id
    shows up in the log and the pid files; everything else is fixed."""
    real = open("/proc/sys/kernel/random/boot_id").read().strip()

    def norm(text):
        return text.replace(real, "<boot_id>").replace(BOOT_ID, "<boot_id>")

    return norm


def normalize_file(rel, data, norm):
    if rel.endswith("/module.prop"):
        # The release version changes every release; the stages don't set it.
        return "\n".join("version=<module.prop>" if l.startswith("version=") else "versionCode=<module.prop>" if l.startswith("versionCode=") else l
                         for l in data.split("\n"))
    if rel.endswith("/repeat.pid"):
        return "<pid>\n" if data.strip().isdigit() else data
    return norm(data)


def snapshot(root, norm):
    """Every file a stage can have changed: path -> [mode, owner, content]."""
    snap = {}
    for w in [PDIR, TMP, f"{MOD}/module.prop"]:
        top = root + w
        if not os.path.lexists(top):
            continue
        walk = [(os.path.dirname(top), [], [os.path.basename(top)])] if not os.path.isdir(top) else os.walk(top)
        for dirpath, dirs, fnames in walk:
            for p in [os.path.join(dirpath, f) for f in fnames] + [os.path.join(dirpath, d) for d in dirs]:
                rel = p[len(root):]
                s = os.lstat(p)
                mode, owner = oct(s.st_mode & 0o7777), f"{s.st_uid}:{s.st_gid}"
                if st.S_ISREG(s.st_mode):
                    with open(p, "rb") as f:
                        snap[rel] = [mode, owner, normalize_file(rel, f.read().decode("utf-8", "replace"), norm)]
                elif st.S_ISDIR(s.st_mode):
                    snap[rel] = [mode, owner, None]
    return snap


def delta(prev, cur):
    """A file a stage only appended to (props.log) is recorded as what was added."""
    if prev and prev[:2] == cur[:2] and prev[2] and cur[2] and cur[2].startswith(prev[2]):
        return [cur[0], cur[1], "(appended)\n" + cur[2][len(prev[2]):]]
    return cur


def procs_in(root, but=()):
    out = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            if os.readlink(f"/proc/{pid}/root") != root:
                continue
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode()
        except OSError:
            continue
        if not any(b in cmd for b in but):
            out.append(pid)
    return out


def wait_for(cond, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cond():
            return True
        time.sleep(0.05)
    return cond()


def run_scenario(name, module_dir, binary, sc):
    """Runs the three stages (and the repeat loop); returns what each did."""
    root = os.path.join(WORK, name)
    build_root(root, module_dir, binary, sc)
    norm = normalizer()
    proc = sc.get("repeat")
    if proc:
        subprocess.run(["mount", "-t", "proc", "proc", f"{root}/proc"], check=True)
    try:
        out = {"stages": [], "repeat": None}
        pos = 0
        prev_files, prev_props = snapshot(root, norm), props_of(root)
        log = lambda: open(f"{root}/calls.log").read()
        for stage in STAGES:
            env = {"PATH": "/bin", "HOME": "/", "KSU": "true"}
            p = subprocess.run([CHROOT, root, "/bin/sh", f"{MOD}/{stage}.sh"], env=env, stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=int(os.environ.get("STAGE_TIMEOUT", "120")))
            # Wait for the stage's own processes; the repeat worker stays.
            wait_for(lambda: not procs_in(root, but=("__repeat",)), 60)
            calls = log()[pos:]
            pos += len(calls)
            calls = "\n".join(c for c in calls.splitlines() if not c.startswith("repeat: "))
            files, props = snapshot(root, norm), props_of(root)
            out["stages"].append({
                "stage": stage,
                "exit": p.returncode,
                "output": norm(p.stdout + p.stderr),
                "calls": [norm(c) for c in calls.splitlines()],
                "props": {k: [prev_props.get(k), props.get(k)] for k in sorted(set(prev_props) | set(props)) if prev_props.get(k) != props.get(k)},
                "changed": {k: delta(prev_files.get(k), v) for k, v in sorted(files.items()) if prev_files.get(k) != v},
                "removed": sorted(k for k in prev_files if k not in files),
            })
            prev_files, prev_props = files, props
        if proc:
            out["repeat"] = drive_repeat(root, norm, log, pos)
        return out
    finally:
        for pid in procs_in(root):
            try:
                os.kill(int(pid), 9)
            except OSError:
                pass
        wait_for(lambda: not procs_in(root), 10)
        if proc:
            subprocess.run(["umount", "-l", f"{root}/proc"], check=False)
        shutil.rmtree(root, ignore_errors=True)


def pos_lines(text, pos):
    """The line index at character offset pos."""
    return text[:pos].count("\n")


def drive_repeat(root, norm, log, pos):
    """The loop puts back a reverted prop, then the master switch stops it.
    How many ticks fit in the waits varies, so the worker's calls (from its
    start, during the stages) and its log lines are compared as sets."""
    worker = lambda: procs_in(root, but=()) and any("__repeat" in open(f"/proc/{p}/cmdline").read() for p in procs_in(root))
    started = bool(worker())
    logfile = f"{root}{TMP}/logs/props.log"
    log_start = len(open(logfile).read())
    write(f"{root}/fixture/props/ro.allow.mock.location", "1")
    reapplied = wait_for(lambda: open(f"{root}/fixture/props/ro.allow.mock.location").read() == "0", 15)
    cfg = open(f"{root}{PDIR}/config.sh").read()
    write(f"{root}{PDIR}/config.sh", re.sub(r"^repeat_enabled=.*$", "repeat_enabled=0", cfg, flags=re.M))
    exited = wait_for(lambda: not worker(), 15)
    calls = log().splitlines()
    calls = [c[len("repeat: "):] for c in calls if c.startswith("repeat: ")] + [c for c in calls[pos_lines(log(), pos):] if not c.startswith("repeat: ")]
    return {
        "worker_started": started,
        "reverted_prop_put_back": reapplied,
        "stopped_by_master_switch": exited,
        "calls": sorted({norm(c) for c in calls}),
        "log_added": sorted({norm(l) for l in open(logfile).read()[log_start:].splitlines()}),
        "pid_files_left": sorted(f for f in os.listdir(f"{root}{TMP}") if f.startswith("repeat.")),
    }


def describe(expected, actual):
    """Readable differences between two scenario records."""
    lines = []
    for e, a in zip(expected["stages"], actual["stages"]):
        sl = []
        for key in ("exit", "output"):
            if e[key] != a[key]:
                sl.append(f"    {key}: expected {e[key]!r}, got {a[key]!r}")
        if e["calls"] != a["calls"]:
            for l in difflib.unified_diff(e["calls"], a["calls"], "expected", "actual", lineterm="", n=0):
                if l[:1] in "+-" and not l.startswith(("+++", "---")):
                    sl.append(f"    {l[0]} call {l[1:]}")
        for k in sorted(set(e["props"]) | set(a["props"])):
            if e["props"].get(k) != a["props"].get(k):
                sl.append(f"    prop {k}: expected {e['props'].get(k)}, got {a['props'].get(k)}")
        for k in sorted(set(e["changed"]) | set(a["changed"])):
            x, y = e["changed"].get(k), a["changed"].get(k)
            if x == y:
                continue
            if x is None:
                sl.append(f"    + changes {k}")
            elif y is None:
                sl.append(f"    - no longer changes {k}")
            else:
                if x[:2] != y[:2]:
                    sl.append(f"    ~ {k}: mode/owner {x[0]} {x[1]} -> {y[0]} {y[1]}")
                if x[2] != y[2]:
                    sl.append(f"    ~ {k} content:")
                    d = difflib.unified_diff((x[2] or "").split("\n"), (y[2] or "").split("\n"), lineterm="", n=0)
                    sl.extend(f"        {l}" for l in list(d)[2:30])
        if e["removed"] != a["removed"]:
            sl.append(f"    removed: expected {e['removed']}, got {a['removed']}")
        if sl:
            lines.append(f"  [{e['stage']}]")
            lines.extend(sl)
    if expected.get("repeat") != actual.get("repeat"):
        lines.append("  [repeat loop]")
        er, ar = expected.get("repeat") or {}, actual.get("repeat") or {}
        for k in sorted(set(er) | set(ar)):
            if er.get(k) != ar.get(k):
                lines.append(f"    {k}: expected {er.get(k)}, got {ar.get(k)}")
    return lines


def find_tool(names, why):
    for n in names:
        path = shutil.which(n) or (n if os.path.isabs(n) and os.path.exists(n) else None)
        if path:
            return path
    sys.exit(f"run.py: {why} not found (looked for {', '.join(names)})")


def main():
    global WORK, BUSYBOX, CHROOT
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--binary", required=True, help="static host build of nyxprops")
    ap.add_argument("--module", default=os.path.join(REPO, "module"), help="module directory (default: the repo's module/)")
    ap.add_argument("--update", action="store_true", help="rewrite the expected files instead of comparing")
    ap.add_argument("scenarios", nargs="*", help="default: all")
    a = ap.parse_args()
    if os.geteuid() != 0:
        sys.exit("run.py: needs root (chroot, mknod, mount) - run with sudo")
    BUSYBOX = find_tool([os.environ.get("NYX_BUSYBOX", ""), "busybox", "/bin/busybox", "/usr/bin/busybox"], "busybox")
    CHROOT = find_tool(["chroot", "/usr/sbin/chroot"], "chroot")
    if "statically linked" not in subprocess.run(["file", "-L", BUSYBOX], capture_output=True, text=True).stdout:
        sys.exit(f"run.py: {BUSYBOX} must be statically linked (Debian/Ubuntu: busybox-static)")
    names = a.scenarios or list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit(f"run.py: unknown scenario(s): {', '.join(unknown)}")
    binary = os.path.abspath(a.binary)
    failed = 0
    with tempfile.TemporaryDirectory(prefix="nyxprops-boot-") as work:
        WORK = os.path.realpath(work)
        for n in names:
            t0 = time.time()
            actual = run_scenario(n, os.path.abspath(a.module), binary, SCENARIOS[n])
            path = os.path.join(EXPECTED, f"{n}.json")
            ncalls = sum(len(s["calls"]) for s in actual["stages"])
            if a.update:
                os.makedirs(EXPECTED, exist_ok=True)
                with open(path, "w") as f:
                    json.dump({"scenario": n, **actual}, f, indent=1, ensure_ascii=False)
                    f.write("\n")
                print(f"WROTE {n:<16} ({ncalls} calls, {time.time() - t0:.1f}s)")
                continue
            if not os.path.exists(path):
                failed += 1
                print(f"FAIL  {n:<16} no expected file {os.path.relpath(path, REPO)} (run with --update)")
                continue
            with open(path) as f:
                expected = json.load(f)
            diff = describe(expected, actual)
            if diff:
                failed += 1
                print(f"FAIL  {n:<16} ({ncalls} calls)")
                for l in diff[:120]:
                    print(l)
            else:
                print(f"PASS  {n:<16} ({ncalls} calls, {time.time() - t0:.1f}s)")
    if not a.update:
        print(f"== {len(names) - failed}/{len(names)} scenarios match tests/boot/expected/")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
