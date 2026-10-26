use crate::backend::Backend;
use crate::dates::Dates;
use crate::{fsx, text};
use std::io::Write;
use std::process::{Command, Stdio};

pub struct Engine {
    pub be: Backend,
    pub dates: Dates,
    pub avb_version: String,
    pub vbmeta_size: String,
    pub logfile: String,
    pub moddir: String,
    touched: Vec<String>,
    failed: Vec<String>,
}

pub struct Headers {
    pub enabled: Option<i64>,
    pub stage: Option<String>,
    pub min_sdk: Option<i64>,
    pub max_sdk: Option<i64>,
    pub repeat: Option<i64>,
}

fn header(text: &str, key: &str, numeric: bool) -> Option<String> {
    for line in text.lines() {
        let l = line.strip_prefix('#')?;
        let mut rest = l.trim_start_matches([' ', '\t']);
        let Some(after) = rest.strip_prefix(key).and_then(|r| r.strip_prefix(':')) else {
            if !line.starts_with('#') {
                continue;
            }
            continue;
        };
        rest = after.trim_start_matches([' ', '\t']);
        let captured: String = if numeric {
            rest.bytes().take_while(u8::is_ascii_digit).map(char::from).collect()
        } else {
            rest.chars().take_while(|c| c.is_ascii_alphabetic() || *c == '-').collect()
        };
        if numeric && captured.is_empty() {
            continue;
        }
        return Some(captured);
    }
    None
}

impl Headers {
    pub fn parse(text: &str) -> Self {
        Headers {
            enabled: header(text, "enabled", true).and_then(|s| s.parse().ok()),
            stage: header(text, "stage", false).filter(|s| !s.is_empty()),
            min_sdk: header(text, "min_sdk", true).and_then(|s| s.parse().ok()),
            max_sdk: header(text, "max_sdk", true).and_then(|s| s.parse().ok()),
            repeat: header(text, "repeat", true).and_then(|s| s.parse().ok()),
        }
    }
}

#[derive(Clone, Copy)]
enum OnSkip {
    Log,
    Silent,
}

impl Engine {
    pub fn new(be: Backend, dates: Dates, avb_version: String, vbmeta_size: String, logfile: String, moddir: String) -> Self {
        Engine {
            be,
            dates,
            avb_version,
            vbmeta_size,
            logfile,
            moddir,
            touched: Vec::new(),
            failed: Vec::new(),
        }
    }

    pub fn log(&self, tag: &str, target: &str) {
        if !self.logfile.is_empty() {
            fsx::append_line(&self.logfile, &format!("[{tag}]: nyxprops {target}"));
        }
    }

    /// Sets a prop. Logs `name=shown` and notes its area, or logs the failure.
    fn write(&mut self, name: &str, value: &str, shown: &str) {
        if self.be.set(name, value) {
            self.log("prop", &format!("{name}={shown}"));
            self.note_touched(name);
        } else {
            self.log_failed(&format!("{name}={shown}"));
        }
    }

    /// Deletes a prop and logs it, or logs the failure. The caller notes the
    /// area first, while the prop still exists to read its context from.
    fn remove(&mut self, name: &str) {
        if self.be.delete(name) {
            self.log("prop", &format!("{name}=(deleted)"));
        } else {
            self.log_failed(&format!("{name}=(deleted)"));
        }
    }

    /// Logs a failed write once per run: the repeat loop retries the same
    /// write every tick, and the log shouldn't grow with each one.
    fn log_failed(&mut self, what: &str) {
        if !self.failed.iter().any(|f| f == what) {
            self.log("prop_error", &format!("write failed: {what}"));
            self.failed.push(what.to_string());
        }
    }

    fn note_touched(&mut self, name: &str) {
        let ctx = self.be.context(name);
        if ctx.is_empty() {
            return;
        }
        if !self.touched.iter().any(|c| c == &ctx) {
            self.touched.push(ctx);
        }
    }

    pub fn reset_touched(&mut self) {
        self.touched.clear();
    }

    pub fn touched_any(&self) -> bool {
        !self.touched.is_empty()
    }

    fn resolve_tokens(&self, mut line: String) -> Result<String, &'static str> {
        if line.contains("{vbmeta_size}") {
            line = line.replace("{vbmeta_size}", &self.vbmeta_size);
        }
        if line.contains("{avb_version}") {
            line = line.replace("{avb_version}", &self.avb_version);
        }
        if line.contains("{security_patch}") {
            if self.dates.security_patch.is_empty() {
                return Err("{security_patch}");
            }
            line = line.replace("{security_patch}", &self.dates.security_patch);
        }
        if line.contains("{yyyy_mm}") {
            if self.dates.yyyy_mm.is_empty() {
                return Err("{yyyy_mm}");
            }
            line = line.replace("{yyyy_mm}", &self.dates.yyyy_mm);
        }
        if line.contains("{vendor_patch}") {
            if self.dates.vendor_patch.is_empty() {
                return Err("{vendor_patch}");
            }
            line = line.replace("{vendor_patch}", &self.dates.vendor_patch);
        }
        Ok(line)
    }

    fn apply_rule(&mut self, fields: &[&str]) {
        let mode = fields[0];
        let name = fields[1];
        let rest = &fields[2..];
        match mode {
            "contains" => {
                if rest.len() < 2 {
                    self.log("prop_error", &format!("contains needs <prop> <needle> <value>: '{name}'"));
                    return;
                }
                let needle = rest[0];
                let value = rest[1..].join(" ");
                if self.be.get(name).contains(needle) {
                    self.write(name, &value, &value);
                }
            }
            "clear" => {
                if !self.be.get(name).is_empty() {
                    self.write(name, "", "(cleared)");
                }
            }
            "delete" => {
                if self.be.prop_exists(name) {
                    self.note_touched(name);
                    self.remove(name);
                }
            }
            "delete_matching" => self.delete_matching(name),
            "missing" => {
                let value = rest.join(" ");
                if self.be.get(name).is_empty() {
                    self.write(name, &value, &value);
                }
            }
            "replace" => {
                if rest.is_empty() {
                    self.log("prop_error", &format!("replace needs <prop> <needle> [value]: '{name}'"));
                    return;
                }
                let needle = rest[0];
                let repl = rest[1..].join(" ");
                if needle.is_empty() {
                    self.log("prop_error", &format!("replace with an empty needle would not terminate: '{name}'"));
                    return;
                }
                let cur = self.be.get(name);
                if !cur.contains(needle) {
                    return;
                }
                let new = cur.replace(needle, &repl);
                if new != cur {
                    self.write(name, &new, &new);
                }
            }
            "reset" => {
                let value = rest.join(" ");
                let cur = self.be.get(name);
                if !cur.is_empty() && cur != value {
                    self.write(name, &value, &value);
                }
            }
            "missing_match" => {
                let value = rest.join(" ");
                let cur = self.be.get(name);
                if cur.is_empty() || cur != value {
                    self.write(name, &value, &value);
                }
            }
            "same_as" => {
                if rest.is_empty() {
                    self.log("prop_error", &format!("same_as needs <prop> <source-prop>: '{name}'"));
                    return;
                }
                let src = rest[0];
                let sval = self.be.get(src);
                if !sval.is_empty() && !self.be.get(name).is_empty() {
                    self.write(name, &sval, &sval);
                }
            }
            other => self.log("prop_error", &format!("unknown mode '{other}' for '{name}'")),
        }
    }

    fn delete_matching(&mut self, pattern: &str) {
        let names: Vec<String> = self.be.dump_lines().iter().filter_map(|l| name_from_dump_line(l)).collect();
        let matched = grep_e(pattern, &names);
        let mut ctxs: Vec<String> = Vec::new();
        for m in &matched {
            if m.is_empty() {
                continue;
            }
            let ctx = self.be.context(m);
            if !ctx.is_empty() {
                ctxs.push(ctx);
            }
            self.remove(m);
        }
        for c in ctxs {
            if !self.touched.iter().any(|t| t == &c) {
                self.touched.push(c);
            }
        }
    }

    pub fn apply_presets(&mut self, dir: &str, want_stage: &str) {
        self.reset_touched();
        if !fsx::is_dir(dir) {
            self.log("prop_error", &format!("props directory '{dir}' not found, no props applied"));
            return;
        }
        let dev_sdk = self.dev_sdk();
        for path in fsx::glob_props(dir) {
            if !fsx::is_file(&path) {
                continue;
            }
            let file = fsx::basename(&path).to_string();
            let Some(text) = fsx::read_to_string(&path) else { continue };
            let h = Headers::parse(&text);

            let stage = h.stage.as_deref().unwrap_or("service");
            if stage != want_stage {
                continue;
            }
            if h.enabled.unwrap_or(1) != 1 {
                self.log("prop_preset_skipped", &file);
                continue;
            }
            if let Some(reason) = sdk_gate_reason(&h, dev_sdk.as_deref(), &file) {
                self.log("prop_preset_skipped", &reason);
                continue;
            }
            self.log("prop_preset", &file);
            self.apply_lines(&text, &file, OnSkip::Log);
        }
    }

    pub fn apply_single(&mut self, path: &str) {
        if !fsx::is_file(path) {
            return;
        }
        let Some(text) = fsx::read_to_string(path) else { return };
        let h = Headers::parse(&text);
        if h.enabled.unwrap_or(1) != 1 {
            return;
        }
        let dev_sdk = self.dev_sdk();
        if !preset_sdk_ok(&h, dev_sdk.as_deref()) {
            return;
        }
        let file = fsx::basename(path).to_string();
        self.apply_lines(&text, &file, OnSkip::Silent);
    }

    fn apply_lines(&mut self, text: &str, file: &str, on_skip: OnSkip) {
        let lines: Vec<String> = {
            let mut v: Vec<String> = text.split('\n').map(str::to_string).collect();
            if text.ends_with('\n') || text.is_empty() {
                v.pop();
            }
            v
        };
        for raw in lines {
            // Blank lines and comments are skipped before tokens are resolved,
            // so a comment that mentions a token is never reported.
            match text::fields(&raw).first() {
                None => continue,
                Some(f) if f.starts_with('#') => continue,
                Some(_) => {}
            }
            let line = match self.resolve_tokens(raw.clone()) {
                Ok(l) => l,
                Err(tok) => {
                    if let OnSkip::Log = on_skip {
                        self.log("prop_skip", &format!("unresolved {tok}: {raw}"));
                    }
                    continue;
                }
            };
            let fields = text::fields(&line);
            if fields.len() < 2 {
                if let OnSkip::Log = on_skip {
                    self.log("prop_error", &format!("malformed line in {file}: {line}"));
                }
                continue;
            }
            self.apply_rule(&fields);
        }
    }

    pub fn rebuild_touched_areas(&mut self, strategy: &str) {
        match strategy {
            "off" => {}
            "global" => self.rebuild_global(),
            "area" => {
                let touched = std::mem::take(&mut self.touched);
                for ctx in &touched {
                    if ctx.is_empty() {
                        continue;
                    }
                    match self.be.rebuild_representative(ctx) {
                        None => self.log("prop_rebuild_warn", &format!("no surviving prop in {ctx} to scope a rebuild")),
                        Some(rep) => {
                            let out = self.be.rebuild_area(&rep);
                            if let Some(err) = rebuild_error(&out) {
                                self.log("prop_rebuild_warn", &format!("{ctx}: {err}"));
                            } else {
                                self.log("prop_rebuild", ctx);
                            }
                        }
                    }
                }
                self.touched = touched;
            }
            other => self.log("prop_error", &format!("unknown hide_compact strategy '{other}', skipping rebuild")),
        }
    }

    fn rebuild_global(&self) {
        let out = self.be.rebuild_global();
        if let Some(err) = rebuild_error(&out) {
            self.log(
                "prop_rebuild_warn",
                &format!("global rebuild hit an unparseable area (harmless for our props): {err}"),
            );
        }
        self.log("prop_rebuild", "global");
    }

    fn dev_sdk(&self) -> Option<String> {
        let v = self.be.get("ro.build.version.sdk");
        if text::is_digits(&v) {
            Some(v)
        } else {
            None
        }
    }
}

fn name_from_dump_line(line: &str) -> Option<String> {
    let rest = line.strip_prefix('[')?;
    let close = rest.find(']')?;
    if rest[close + 1..].starts_with(": ") {
        Some(rest[..close].to_string())
    } else {
        None
    }
}

fn grep_e(pattern: &str, names: &[String]) -> Vec<String> {
    let mut child = match Command::new("grep")
        .args(["-E", pattern])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let mut buf = String::new();
        for n in names {
            buf.push_str(n);
            buf.push('\n');
        }
        let _ = stdin.write_all(buf.as_bytes());
    }
    match child.wait_with_output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).lines().map(str::to_string).collect(),
        Err(_) => Vec::new(),
    }
}

/// The first line of resetprop's rebuild output that reports a failed or
/// corrupted area, in any letter case. resetprop exits 0 either way.
fn rebuild_error(out: &str) -> Option<&str> {
    out.lines().find(|l| {
        let l = l.to_ascii_lowercase();
        l.contains("failed to rebuild") || l.contains("corrupted")
    })
}

pub fn preset_sdk_ok(h: &Headers, dev_sdk: Option<&str>) -> bool {
    if h.min_sdk.is_none() && h.max_sdk.is_none() {
        return true;
    }
    let Some(dev) = dev_sdk else { return false };
    if let Some(min) = h.min_sdk {
        if text::lt(dev, min) {
            return false;
        }
    }
    if let Some(max) = h.max_sdk {
        if text::gt(dev, max) {
            return false;
        }
    }
    true
}

fn sdk_gate_reason(h: &Headers, dev_sdk: Option<&str>, file: &str) -> Option<String> {
    if h.min_sdk.is_none() && h.max_sdk.is_none() {
        return None;
    }
    let Some(dev) = dev_sdk else {
        return Some(format!("{file} (ro.build.version.sdk unreadable)"));
    };
    if let Some(min) = h.min_sdk {
        if text::lt(dev, min) {
            return Some(format!("{file} (sdk {dev} < min_sdk {min})"));
        }
    }
    if let Some(max) = h.max_sdk {
        if text::gt(dev, max) {
            return Some(format!("{file} (sdk {dev} > max_sdk {max})"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_parsing() {
        let t = "# name: X\n# enabled: 0\n# stage: post-fs-data\n# min_sdk: 36\nreset ro.x v\n";
        let h = Headers::parse(t);
        assert_eq!(h.enabled, Some(0));
        assert_eq!(h.stage.as_deref(), Some("post-fs-data"));
        assert_eq!(h.min_sdk, Some(36));
        assert_eq!(h.max_sdk, None);
        let h2 = Headers::parse("reset ro.x v\n");
        assert_eq!(h2.enabled, None);
        assert_eq!(h2.stage, None);
    }

    #[test]
    fn dump_name_extract() {
        assert_eq!(name_from_dump_line("[ro.x]: [v]").as_deref(), Some("ro.x"));
        assert_eq!(name_from_dump_line("[ro.y]: value").as_deref(), Some("ro.y"));
        assert_eq!(name_from_dump_line("[ro.z]:no-space"), None);
        assert_eq!(name_from_dump_line("junk"), None);
    }

    #[test]
    fn rebuild_error_any_case() {
        let out = "resetprop: rebuilding\nresetprop: Failed to rebuild u:object_r:radio_prop:s0\n";
        assert_eq!(rebuild_error(out), Some("resetprop: Failed to rebuild u:object_r:radio_prop:s0"));
        assert_eq!(
            rebuild_error("radio_prop: area CORRUPTED, skipped"),
            Some("radio_prop: area CORRUPTED, skipped")
        );
        assert_eq!(
            rebuild_error("resetprop: failed to rebuild x\n"),
            Some("resetprop: failed to rebuild x")
        );
        assert_eq!(rebuild_error("resetprop: rebuilt 3 areas\n"), None);
        assert_eq!(rebuild_error(""), None);
    }

    #[test]
    fn failed_write_logged_once() {
        let dir = std::env::temp_dir().join(format!("nyxprops-failed-{}", std::process::id()));
        fsx::mkdir_p(&dir.to_string_lossy());
        let logfile = dir.join("props.log").to_string_lossy().into_owned();
        let be = Backend {
            bin: None,
            mode: crate::backend::Mode::Magisk,
            init_warn: None,
        };
        let mut e = Engine::new(be, Dates::default(), String::new(), String::new(), logfile.clone(), String::new());
        e.log_failed("ro.x=1");
        e.log_failed("ro.y=(deleted)");
        e.log_failed("ro.x=1");
        let log = fsx::read_to_string(&logfile).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            log,
            "[prop_error]: nyxprops write failed: ro.x=1\n[prop_error]: nyxprops write failed: ro.y=(deleted)\n"
        );
    }
}
