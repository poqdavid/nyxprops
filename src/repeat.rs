use crate::engine::{Engine, Headers};
use crate::stages;
use crate::{fsx, text, tools};
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn pid_file() -> String {
    format!("{}/repeat.pid", stages::tmp_dir())
}
fn bootid_file() -> String {
    format!("{}/repeat.bootid", stages::tmp_dir())
}

fn interval(h: &Headers, floor_raw: &str) -> Option<i64> {
    let r = h.repeat?;
    if r <= 0 {
        return None;
    }
    let floor = if text::is_digits(floor_raw) {
        floor_raw.parse().unwrap_or(30)
    } else {
        30
    };
    Some(if r < floor { floor } else { r })
}

pub fn start(engine: &Engine, repeat_enabled: &str, repeat_min_interval: &str, dir: &str) {
    stop();

    if repeat_enabled != "1" {
        return;
    }
    if !fsx::is_dir(dir) {
        return;
    }
    let dev_sdk = {
        let v = engine.be.get("ro.build.version.sdk");
        if text::is_digits(&v) {
            Some(v)
        } else {
            None
        }
    };

    let mut have = false;
    let mut base: Option<i64> = None;
    for path in fsx::glob_props(dir) {
        if !fsx::is_file(&path) {
            continue;
        }
        let Some(text) = fsx::read_to_string(&path) else { continue };
        let h = Headers::parse(&text);
        let Some(iv) = interval(&h, repeat_min_interval) else { continue };
        if h.enabled.unwrap_or(1) != 1 {
            continue;
        }
        if !crate::engine::preset_sdk_ok(&h, dev_sdk.as_deref()) {
            engine.log("prop_repeat", &format!("{} not repeating (sdk gate)", fsx::basename(&path)));
            continue;
        }
        have = true;
        base = Some(base.map_or(iv, |b: i64| b.min(iv)));
    }
    let Some(base) = base.filter(|_| have) else { return };

    engine.log("prop_repeat", &format!("starting loop (base tick {base}s)"));

    let Ok(exe) = std::env::current_exe() else { return };
    let child = Command::new(exe)
        .arg("__repeat")
        .arg(&engine.moddir)
        .arg(dir)
        .arg(base.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Ok(c) = child {
        fsx::write(&pid_file(), &format!("{}\n", c.id()));
        fsx::write(&bootid_file(), &format!("{}\n", tools::boot_id()));
    }
}

pub fn stop() {
    let pid_file = pid_file();
    let bootid_file = bootid_file();
    if !fsx::is_file(&pid_file) {
        return;
    }
    let old = fsx::read_to_string(&pid_file).unwrap_or_default().trim().to_string();
    let old_boot = fsx::read_to_string(&bootid_file).unwrap_or_default().trim().to_string();
    let cur_boot = tools::boot_id();
    if text::is_digits(&old) && !cur_boot.is_empty() && old_boot == cur_boot && alive(&old) {
        let _ = Command::new("kill").arg(&old).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = std::fs::remove_file(&pid_file);
    let _ = std::fs::remove_file(&bootid_file);
}

fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub fn worker(moddir: &str, dir: &str, base: u64) {
    let (mut engine, _vars) = stages::setup_quiet(moddir);
    let dev_sdk = {
        let v = engine.be.get("ro.build.version.sdk");
        if text::is_digits(&v) {
            Some(v)
        } else {
            None
        }
    };
    let max_sleep = Duration::from_secs(base.max(1));
    let started = Instant::now();
    let mut schedule: BTreeMap<String, (u64, Instant)> = BTreeMap::new();
    let mut first_scan = true;
    loop {
        let now = Instant::now();
        let wait = schedule
            .values()
            .map(|&(_, at)| at.saturating_duration_since(now))
            .min()
            .unwrap_or(max_sleep)
            .min(max_sleep);
        std::thread::sleep(wait);

        let mut vars = crate::config::Vars::with_defaults(&[
            ("repeat_enabled", "1"),
            ("avb_version", "auto"),
            ("hide_compact", "area"),
            ("repeat_min_interval", "30"),
        ]);
        let config = stages::config_path();
        if fsx::is_file(&config) {
            vars.source(&config);
        }
        if vars.get("repeat_enabled") != "1" {
            engine.log("prop_repeat", "master switch off, loop exiting");
            break;
        }

        let now = Instant::now();
        let mut seen: Vec<String> = Vec::new();
        let mut resolved = false;
        engine.reset_touched();
        for path in fsx::glob_props(dir) {
            if !fsx::is_file(&path) {
                continue;
            }
            let Some(text) = fsx::read_to_string(&path) else { continue };
            let h = Headers::parse(&text);
            let Some(iv) = interval(&h, vars.get("repeat_min_interval")) else {
                continue;
            };
            let iv = iv as u64;
            if h.enabled.unwrap_or(1) != 1 || !crate::engine::preset_sdk_ok(&h, dev_sdk.as_deref()) {
                continue;
            }
            seen.push(path.clone());

            let from = if first_scan { started } else { now };
            let slot = schedule.entry(path.clone()).or_insert((iv, from + Duration::from_secs(iv)));
            if slot.0 != iv {
                *slot = (iv, now + Duration::from_secs(iv));
            }
            if slot.1 > now {
                continue;
            }

            if !resolved {
                engine.avb_version = crate::dates::resolve_avb_version(vars.get("avb_version"));
                engine.dates = crate::dates::Dates::resolve();
                engine.vbmeta_size = stages::read_vbmeta_size(&config);
                resolved = true;
            }
            engine.apply_single(&path);

            let next = slot.1 + Duration::from_secs(iv);
            slot.1 = if next > now { next } else { now + Duration::from_secs(iv) };
        }
        schedule.retain(|p, _| seen.contains(p));
        first_scan = false;

        if engine.touched_any() && engine.be.needs_rebuild() {
            engine.rebuild_touched_areas(vars.get("hide_compact"));
        }
    }
}
