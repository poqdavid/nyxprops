#!/usr/bin/env python3
"""Installer checks for module/customize.sh.

customize.sh runs the way KernelSU runs it: sourced by busybox ash with
ASH_STANDALONE=1 (busybox applets first), ui_print/abort stubbed, inside a
copy of the module as the zip would unpack it. Every /data path in it is moved
under a temporary directory, so the test never reads or writes the machine's
own /data. getprop, getevent and curl are stubs; the four engines are small
scripts that print a version, so any machine can run them.

Covered: the KernelSU and ABI checks, which engine each ABI keeps, the
integrity check, the resetprop-rs setup, a fresh install, and an upgrade that
keeps (Volume Down) or resets (Volume Up) the user's settings and presets.

    python3 scripts/test-install.py [-v]

Needs busybox; NYX_BUSYBOX=/path/to/busybox picks one.
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "module"
ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]
BUSYBOX = os.environ.get("NYX_BUSYBOX") or shutil.which("busybox")
DONE = "[-] Done. Open the module's WebUI"


def find_has_delete():
    """verify.sh cleans up with `find -delete`, which KernelSU's busybox (Magisk's
    build) has; some distro busybox builds leave it out."""
    if not BUSYBOX:
        return False
    with tempfile.TemporaryDirectory() as t:
        return subprocess.run([BUSYBOX, "find", t, "-name", "x", "-delete"], capture_output=True).returncode == 0


class Device:
    """A temporary device: the unpacked zip in MODPATH and a fake /data."""

    def __init__(self, tmp, abi="arm64-v8a", engines=None, rs=None, data=None):
        """`data` is the fake /data root; pass another Device's to upgrade it."""
        self.tmp = Path(tmp)
        self.data = Path(data) if data else self.tmp / "data"
        self.modpath = self.tmp / "modules_update/nyxprops"
        self.persist = self.data / "adb/nyxprops"
        self.bin = self.tmp / "stubs"
        shutil.copytree(MODULE, self.modpath, ignore=shutil.ignore_patterns("*.sha256", "webroot"))
        script = (self.modpath / "customize.sh").read_text()
        script = script.replace("/data/adb/", f"{self.data}/adb/").replace("/data/data/", f"{self.data}/data/")
        (self.modpath / "customize.sh").write_text(script)
        # The four engines CI builds, as scripts that report which one ran.
        for a in ABIS:
            ok = (engines or {}).get(a, True)
            self.stub(self.modpath / f"bin/nyxprops-{a}", f'echo "nyxprops v1.0.0 ({a})"' if ok else "exit 1")
        # resetprop-rs: the zip bundles the ARM builds; here they are stubs
        # that pass (or fail) the installer's `-h` smoke test.
        for f in self.modpath.glob("bin/resetprop-*"):
            f.unlink()
        for a, ok in (rs or {"arm64-v8a": True, "armeabi-v7a": True}).items():
            self.stub(self.modpath / f"bin/resetprop-{a}", "exit 0" if ok else "exit 1")
        self.bin.mkdir()
        self.stub(self.bin / "getprop", f'[ "$1" = ro.product.cpu.abi ] && echo "{abi}"\nexit 0')
        self.stub(self.bin / "getevent", '[ -f "$NYX_KEY" ] && echo "/dev/input/event3: EV_KEY $(cat "$NYX_KEY") DOWN"\nexit 0')
        self.stub(self.bin / "curl", "exit 7")  # no network: every download fails

    @staticmethod
    def stub(path, body):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"#!{BUSYBOX} sh\n{body}\n")
        path.chmod(0o755)

    def install(self, key=None, ksu=True):
        env = {"PATH": f"{self.bin}:/usr/bin:/bin", "MODPATH": str(self.modpath), "TMPDIR": str(self.tmp),
               "ASH_STANDALONE": "1", "NYX_KEY": str(self.tmp / "key")}
        if ksu:
            env["KSU"] = "true"
        if key:
            (self.tmp / "key").write_text(key)
        run = subprocess.run(
            [BUSYBOX, "sh", "-c", 'ui_print() { printf "%s\\n" "$*"; }; abort() { printf "%s\\n" "$*"; exit 1; }; cd "$MODPATH" && . ./customize.sh'],
            env=env, capture_output=True, text=True, timeout=60,
        )
        return run.returncode, run.stdout + run.stderr

    def config(self):
        return dict(re.findall(r"^([a-z_]+)=(.*)$", (self.persist / "config.sh").read_text(), re.M))


def shipped(name):
    return (MODULE / "props" / name).read_text()


@unittest.skipUnless(BUSYBOX, "busybox not found (set NYX_BUSYBOX)")
class Checks(unittest.TestCase):
    def test_needs_kernelsu(self):
        with tempfile.TemporaryDirectory() as t:
            d = Device(t)
            code, out = d.install(ksu=False)
            self.assertNotEqual(code, 0)
            self.assertIn("[!] NyxProps is for KernelSU / KernelSU-Next only.", out)
            self.assertFalse(d.persist.exists())

    def test_each_abi_keeps_its_engine(self):
        for abi, getprop in [("arm64-v8a", "arm64-v8a"), ("armeabi-v7a", "armeabi-v7a"), ("x86", "x86"), ("x86_64", "x86_64"),
                             ("arm64-v8a", "aarch64"), ("armeabi-v7a", "armv8l")]:
            with self.subTest(getprop=getprop), tempfile.TemporaryDirectory() as t:
                d = Device(t, abi=getprop)
                code, out = d.install()
                self.assertEqual(code, 0, out)
                self.assertIn(f"+ nyxprops engine ready (nyxprops-{abi})", out)
                self.assertIn(f"({abi})", (d.modpath / "bin/nyxprops").read_text())
                self.assertEqual(sorted(p.name for p in d.modpath.glob("bin/nyxprops*")), ["nyxprops"])
                self.assertEqual(oct((d.modpath / "bin/nyxprops").stat().st_mode & 0o777), "0o755")

    def test_unknown_abi_is_refused(self):
        for getprop, shown in [("mips", "mips"), ("riscv64", "riscv64"), ("", "unknown")]:
            with self.subTest(getprop=getprop), tempfile.TemporaryDirectory() as t:
                d = Device(t, abi=getprop)
                code, out = d.install()
                self.assertNotEqual(code, 0)
                self.assertIn(f"[!] No nyxprops engine for abi '{shown}'", out)
                self.assertFalse(d.persist.exists())

    def test_engine_that_cannot_run_is_refused(self):
        with tempfile.TemporaryDirectory() as t:
            d = Device(t, abi="x86_64", engines={"x86_64": False})
            code, out = d.install()
            self.assertNotEqual(code, 0)
            self.assertIn("[!] nyxprops engine failed to run on this device (x86_64)", out)
            self.assertFalse(d.persist.exists())

    def test_integrity_check(self):
        with tempfile.TemporaryDirectory() as t:
            d = Device(t)
            subprocess.run(["sh", str(ROOT / "scripts/gen-hashes.sh"), str(d.modpath)], check=True, capture_output=True)
            code, out = d.install()
            self.assertEqual(code, 0, out)
            self.assertIn("[+] Integrity check passed", out)
            if find_has_delete():
                self.assertEqual(list(d.modpath.rglob("*.sha256")), [])
        with tempfile.TemporaryDirectory() as t:
            d = Device(t)
            subprocess.run(["sh", str(ROOT / "scripts/gen-hashes.sh"), str(d.modpath)], check=True, capture_output=True)
            (d.modpath / "service.sh").write_text((d.modpath / "service.sh").read_text() + "\n# tampered\n")
            code, out = d.install()
            self.assertNotEqual(code, 0)
            self.assertIn("hash mismatch for", out)
            self.assertIn("[!] Integrity check FAILED", out)
            self.assertFalse(d.modpath.exists())
            self.assertFalse(d.persist.exists())

    def test_resetprop_rs(self):
        cases = [
            ("arm64-v8a", {"arm64-v8a": True, "armeabi-v7a": True}, "+ bundled resetprop-rs ok (resetprop-arm64-v8a)", ["resetprop-arm64-v8a"]),
            ("armeabi-v7a", {"arm64-v8a": True, "armeabi-v7a": True}, "+ bundled resetprop-rs ok (resetprop-armeabi-v7a)", ["resetprop-armeabi-v7a"]),
            ("arm64-v8a", {"arm64-v8a": False, "armeabi-v7a": True}, "! download failed", []),
            ("x86_64", {"arm64-v8a": True, "armeabi-v7a": True}, "- downloading resetprop-rs (resetprop-x86_64)...", []),
        ]
        for abi, rs, line, kept in cases:
            with self.subTest(abi=abi, rs=rs), tempfile.TemporaryDirectory() as t:
                d = Device(t, abi=abi, rs=rs)
                code, out = d.install()
                self.assertEqual(code, 0, out)
                self.assertIn(line, out)
                self.assertEqual(sorted(p.name for p in d.modpath.glob("bin/resetprop-*")), kept)
                self.assertIn("resetprop-rs is ready" if kept else "Using the stock resetprop", out)
                self.assertTrue((d.modpath / "bin/nyxprops").exists())

    def test_fresh_install(self):
        with tempfile.TemporaryDirectory() as t:
            d = Device(t)
            code, out = d.install()
            self.assertEqual(code, 0, out)
            self.assertIn(DONE, out)
            self.assertNotIn("existing NyxProps config folder", out)
            shipped_keys = re.findall(r"^([a-z_]+)=", (MODULE / "config.sh").read_text(), re.M)
            cfg = d.config()
            self.assertEqual([k for k in shipped_keys if k not in cfg], [])
            self.assertIn(int(cfg["vbmeta_size"]), {5504 + n * 1024 for n in range(1, 15)})
            names = sorted(p.name for p in (MODULE / "props").glob("*.prop"))
            self.assertEqual(sorted(p.name for p in d.persist.glob("props/*.prop")), names)
            self.assertEqual(sorted(p.name for p in d.persist.glob("props/.defaults/*.prop")), names)
            for gone in ["customize.sh", "verify.sh", "config.sh", "props"]:
                self.assertFalse((d.modpath / gone).exists(), gone)
            for kept in ["module.prop", "post-fs-data.sh", "service.sh", "boot-completed.sh", "uninstall.sh", "bin-update.sh"]:
                self.assertTrue((d.modpath / kept).exists(), kept)

    def upgraded(self, key):
        """An installed device with user changes, upgraded with `key` pressed."""
        t = tempfile.TemporaryDirectory()
        d = Device(f"{t.name}/first")
        self.assertEqual(d.install()[0], 0)
        p = d.persist / "props"
        cfg = (d.persist / "config.sh").read_text()
        cfg = cfg.replace("prop_tool='magisk'", "prop_tool='auto'")
        cfg = re.sub(r"^webui_monet=.*\n", "", cfg, flags=re.M)
        (d.persist / "config.sh").write_text(cfg)
        (p / "50-build-type.prop").write_text(shipped("50-build-type.prop") + "reset ro.user.added yes\n")
        # 10-vbmeta: untouched, but the default on the device is older than the zip's.
        old = shipped("10-vbmeta.prop") + "# older default\n"
        (p / "10-vbmeta.prop").write_text(old)
        (p / ".defaults/10-vbmeta.prop").write_text(old)
        # 20-verified-boot: edited by the user, and the default changed too.
        (p / "20-verified-boot.prop").write_text(shipped("20-verified-boot.prop") + "# my edit\n")
        (p / ".defaults/20-verified-boot.prop").write_text(shipped("20-verified-boot.prop") + "# older default\n")
        (p / "99-custom.prop").write_text("# name: Mine\nreset ro.mine 1\n")
        (p / "85-adb-state.prop").unlink()
        again = Device(f"{t.name}/second", data=d.data)
        code, out = again.install(key=key)
        return t, again, code, out

    def test_upgrade_keeps_settings(self):
        t, d, code, out = self.upgraded("KEY_VOLUMEDOWN")
        with t:
            self.assertEqual(code, 0, out)
            self.assertIn("An existing NyxProps config folder", out)
            self.assertIn("[-] Keeping current settings", out)
            cfg = d.config()
            self.assertEqual(cfg["prop_tool"], "'auto'")
            self.assertEqual(cfg["webui_monet"], "0")
            p = d.persist / "props"
            self.assertIn("reset ro.user.added yes", (p / "50-build-type.prop").read_text())
            self.assertEqual((p / "10-vbmeta.prop").read_text(), shipped("10-vbmeta.prop"))
            self.assertIn("^ 10-vbmeta.prop (updated default)", out)
            self.assertIn("# my edit", (p / "20-verified-boot.prop").read_text())
            self.assertEqual((p / ".defaults/20-verified-boot.prop").read_text(), shipped("20-verified-boot.prop"))
            self.assertIn("= 20-verified-boot.prop (kept your edits, default changed)", out)
            self.assertIn("[!] 1 preset(s) on this device differ from the new", out)
            self.assertEqual((p / "85-adb-state.prop").read_text(), shipped("85-adb-state.prop"))
            self.assertIn("+ 85-adb-state.prop", out)
            self.assertEqual((p / "99-custom.prop").read_text(), "# name: Mine\nreset ro.mine 1\n")

    def test_upgrade_resets_settings(self):
        t, d, code, out = self.upgraded("KEY_VOLUMEUP")
        with t:
            self.assertEqual(code, 0, out)
            self.assertIn("[-] Resetting NyxProps settings to default...", out)
            self.assertEqual(d.config()["prop_tool"], "'magisk'")
            p = d.persist / "props"
            self.assertFalse((p / "99-custom.prop").exists())
            self.assertEqual((p / "50-build-type.prop").read_text(), shipped("50-build-type.prop"))
            self.assertEqual(len(list(p.glob("*.prop"))), len(list((MODULE / "props").glob("*.prop"))))


if __name__ == "__main__":
    unittest.main()
