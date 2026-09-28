use crate::tools::{capture, capture_merged, getprop, run_quiet};
use std::process::{Command, Stdio};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Magisk,
    Rs,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Magisk => "magisk",
            Mode::Rs => "rs",
        }
    }
}

pub struct Backend {
    pub bin: Option<String>,
    pub mode: Mode,
    pub init_warn: Option<String>,
}

pub fn init(pref: &str, moddir: &str) -> Backend {
    let rsdir = format!("{moddir}/bin");
    match pref {
        "magisk" => Backend {
            bin: None,
            mode: Mode::Magisk,
            init_warn: None,
        },
        "rs" | "auto" => {
            let abi = getprop("ro.product.cpu.abi");
            let rs = match abi.as_str() {
                a if a.starts_with("arm64") || a.starts_with("aarch64") => Some(format!("{rsdir}/resetprop-arm64-v8a")),
                a if a.starts_with("armeabi") || a.starts_with("armv") => Some(format!("{rsdir}/resetprop-armeabi-v7a")),
                a if a.starts_with("x86_64") => Some(format!("{rsdir}/resetprop-x86_64")),
                a if a.starts_with("x86") => Some(format!("{rsdir}/resetprop-x86")),
                _ => None,
            };
            if let Some(ref p) = rs {
                if is_executable(p) && run_quiet(p, &["-h"]) {
                    return Backend {
                        bin: Some(p.clone()),
                        mode: Mode::Rs,
                        init_warn: None,
                    };
                }
            }
            let warn = if pref == "rs" {
                Some(format!(
                    "prop_tool=rs but no working resetprop-rs for abi '{abi}' at {rsdir}; falling back to magisk resetprop"
                ))
            } else {
                None
            };
            Backend {
                bin: None,
                mode: Mode::Magisk,
                init_warn: warn,
            }
        }
        other => Backend {
            bin: None,
            mode: Mode::Magisk,
            init_warn: Some(format!("unknown prop_tool '{other}', using magisk resetprop")),
        },
    }
}

fn is_executable(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

impl Backend {
    fn prog(&self) -> &str {
        self.bin.as_deref().unwrap_or("resetprop")
    }

    pub fn get(&self, name: &str) -> String {
        capture(self.prog(), &[name])
    }

    pub fn dump_lines(&self) -> Vec<String> {
        capture(self.prog(), &[]).split('\n').map(str::to_string).collect()
    }

    pub fn context(&self, name: &str) -> String {
        capture(self.prog(), &["-Z", name])
    }

    pub fn set(&self, name: &str, value: &str) -> bool {
        match &self.bin {
            Some(bin) => {
                let flag = if name.starts_with("ro.") { "--init" } else { "--stealth" };
                run_devnull(bin, &[flag, name, value])
            }
            None => run_devnull("resetprop", &["-n", name, value]),
        }
    }

    pub fn delete(&self, name: &str) -> bool {
        match &self.bin {
            Some(bin) => run_devnull(bin, &["--nuke", name]),
            None => run_devnull("resetprop", &["-d", name]),
        }
    }

    pub fn prop_exists(&self, name: &str) -> bool {
        let needle = format!("[{name}]: ");
        capture(self.prog(), &[]).lines().any(|l| l.contains(&needle))
    }

    pub fn needs_rebuild(&self) -> bool {
        self.bin.is_none()
    }

    pub fn rebuild_representative(&self, ctx: &str) -> Option<String> {
        let marker = format!("[{ctx}]");
        for line in capture("resetprop", &["-Z"]).split('\n') {
            if line.contains(&marker) {
                if let Some(rep) = first_bracket_before_colon(line) {
                    return Some(rep);
                }
            }
        }
        None
    }

    pub fn rebuild_area(&self, rep: &str) -> String {
        capture_merged("resetprop", &["-c", "-Z", rep])
    }

    pub fn rebuild_global(&self) -> String {
        capture_merged("resetprop", &["-c", "--force"])
    }
}

fn run_devnull(prog: &str, args: &[&str]) -> bool {
    Command::new(prog)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn first_bracket_before_colon(line: &str) -> Option<String> {
    let rest = line.strip_prefix('[')?;
    let close = rest.find(']')?;
    if rest[close + 1..].starts_with(':') {
        Some(rest[..close].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn representative_name_from_dump_line() {
        assert_eq!(first_bracket_before_colon("[ro.x]: [v]").as_deref(), Some("ro.x"));
        assert_eq!(first_bracket_before_colon("[u:object:s0]: ok").as_deref(), Some("u:object:s0"));
        assert_eq!(first_bracket_before_colon("no bracket"), None);
        assert_eq!(first_bracket_before_colon("[x] no colon"), None);
    }
}
