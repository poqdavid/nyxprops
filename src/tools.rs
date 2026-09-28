use std::env;
use std::process::{Command, Stdio};

pub const KSU_BIN_DIR: &str = "/data/adb/ksu/bin";

pub fn prepend_ksu_path() {
    let old = env::var("PATH").unwrap_or_default();
    let new = if old.is_empty() {
        KSU_BIN_DIR.to_string()
    } else {
        format!("{KSU_BIN_DIR}:{old}")
    };
    env::set_var("PATH", new);
}

pub fn run_quiet(prog: &str, args: &[&str]) -> bool {
    Command::new(prog)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub fn capture(prog: &str, args: &[&str]) -> String {
    match Command::new(prog).args(args).stderr(Stdio::null()).output() {
        Ok(o) => crate::text::strip_newlines(String::from_utf8_lossy(&o.stdout).into_owned()),
        Err(_) => String::new(),
    }
}

pub fn capture_merged(prog: &str, args: &[&str]) -> String {
    match Command::new(prog).args(args).stderr(Stdio::piped()).output() {
        Ok(o) => {
            let mut s = o.stdout;
            s.extend_from_slice(&o.stderr);
            crate::text::strip_newlines(String::from_utf8_lossy(&s).into_owned())
        }
        Err(_) => String::new(),
    }
}

pub fn getprop(name: &str) -> String {
    capture("getprop", &[name])
}

pub fn resetprop_w(name: &str, value: &str) {
    let _ = Command::new("resetprop")
        .args(["-w", name, value])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn boot_id() -> String {
    crate::text::strip_newlines(std::fs::read_to_string("/proc/sys/kernel/random/boot_id").unwrap_or_default())
}
