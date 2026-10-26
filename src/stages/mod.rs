pub mod boot_completed;
pub mod post_fs_data;
pub mod service;

use crate::backend;
use crate::config::Vars;
use crate::dates::{self, Dates};
use crate::engine::Engine;
use crate::{fsx, tools};

const PERSIST_DEFAULT: &str = "/data/adb/nyxprops";
const TMP_DEFAULT: &str = "/data/adb/ksu/nyxprops";

pub fn persist_dir() -> String {
    std::env::var("NYX_PERSIST_DIR").unwrap_or_else(|_| PERSIST_DEFAULT.to_string())
}
pub fn tmp_dir() -> String {
    std::env::var("NYX_TMP_DIR").unwrap_or_else(|_| TMP_DEFAULT.to_string())
}
pub fn props_dir() -> String {
    format!("{}/props", persist_dir())
}
pub fn log_dir() -> String {
    format!("{}/logs", tmp_dir())
}
pub fn log_file() -> String {
    format!("{}/logs/props.log", tmp_dir())
}
pub fn config_path() -> String {
    format!("{}/config.sh", persist_dir())
}

/// Engine and config for a boot stage. Opens this boot's log first, so the
/// backend warning below lands in it even when the stage starts a new log.
pub fn setup(moddir: &str) -> (Engine, Vars) {
    let (engine, vars) = setup_quiet(moddir);
    init_boot_log(&engine);

    if let Some(w) = &engine.be.init_warn {
        let tag = if w.starts_with("unknown prop_tool") {
            "prop_error"
        } else {
            "prop_tool_warn"
        };
        engine.log(tag, w);
    }
    (engine, vars)
}

pub fn setup_quiet(moddir: &str) -> (Engine, Vars) {
    fsx::mkdir_p(&log_dir());

    let config = config_path();
    let mut vars = Vars::with_defaults(&[
        ("prop_tool", "magisk"),
        ("hide_compact", "area"),
        ("avb_version", "auto"),
        ("repeat_enabled", "1"),
        ("repeat_min_interval", "30"),
    ]);
    if fsx::is_file(&config) {
        vars.source(&config);
    }

    let vbmeta_size = read_vbmeta_size(&config);
    let avb_version = dates::resolve_avb_version(vars.get("avb_version"));
    let dates = Dates::resolve();
    let be = backend::init(vars.get("prop_tool"), moddir);

    let engine = Engine::new(be, dates, avb_version, vbmeta_size, log_file(), moddir.to_string());
    (engine, vars)
}

pub(crate) fn read_vbmeta_size(config: &str) -> String {
    if let Some(text) = fsx::read_to_string(config) {
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("vbmeta_size=") {
                if !rest.is_empty() {
                    return rest.to_string();
                }
            }
        }
    }
    "8192".to_string()
}

fn init_boot_log(engine: &Engine) {
    let logfile = &engine.logfile;
    if logfile.is_empty() {
        return;
    }
    fsx::mkdir_p(fsx::dirname(logfile));
    let cur = tools::boot_id();
    let mut need = false;
    if !fsx::is_file(logfile) {
        need = true;
    } else if !cur.is_empty() {
        let text = fsx::read_to_string(logfile).unwrap_or_default();
        let last = text
            .lines()
            .rfind(|l| l.starts_with("[boot_id]:"))
            .and_then(|l| l.strip_prefix("[boot_id]:"))
            .map(|r| r.trim_start_matches([' ', '\t']))
            .and_then(|r| r.strip_prefix("nyxprops"))
            .map(|r| r.trim_start_matches([' ', '\t']).to_string())
            .unwrap_or_default();
        if last != cur {
            need = true;
        }
    }
    if need {
        // Start the log fresh, then append the boot id and backend lines.
        fsx::write(logfile, "nyxprops/boot: [logging_initialized]\n");
        engine.log("boot_id", &cur);
        engine.log("prop_tool", engine.be.mode.as_str());
    }
}

pub fn count_presets(dir: &str) -> (u32, u32) {
    let mut total = 0;
    let mut enabled = 0;
    for path in fsx::glob_props(dir) {
        if !fsx::is_file(&path) {
            continue;
        }
        total += 1;
        let en = fsx::read_to_string(&path)
            .map(|t| crate::engine::Headers::parse(&t).enabled.unwrap_or(1))
            .unwrap_or(1);
        if en == 1 {
            enabled += 1;
        }
    }
    (total, enabled)
}
