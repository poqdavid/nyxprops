//! The patch levels the TEE reports, read from the modules that set them:
//! Play Integrity Fork's config, and TEESimulator's config and harvest.
//!
//! Every path is under `root`, which is "" on a device.

use crate::fsx;
use crate::json::{self, Syntax, Value};

const MODULES: &str = "/data/adb/modules";

const PIF_ID: &str = "playintegrityfix";
/// The files Play Integrity Fork loads, in the order it tries them.
const PIF_FILES: [&str; 4] = ["custom.pif.prop", "custom.pif.json", "pif.prop", "pif.json"];
/// Where it can carry the OS patch date: its Build field first, then the
/// property it spoofs.
const PIF_KEYS: [&str; 3] = ["SECURITY_PATCH", "ro.build.version.security_patch", "*.security_patch"];

const TEESIM_ID: &str = "teesim";
const TEESIM_DIR: &str = "/data/adb/teesim";
/// Play Integrity attests through Google Play services.
const GMS: &str = "com.google.android.gms";

/// A calendar date.
#[derive(Clone, Copy, PartialEq, PartialOrd, Debug)]
pub struct Ymd {
    pub y: i64,
    pub m: i64,
    pub d: i64,
}

impl Ymd {
    /// A real calendar date, or `None`.
    pub fn new(y: i64, m: i64, d: i64) -> Option<Ymd> {
        let days = match m {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
            2 => 28,
            _ => return None,
        };
        (0..=9999).contains(&y).then_some(())?;
        (1..=days).contains(&d).then_some(Ymd { y, m, d })
    }

    /// A `YYYY-MM-DD` string that names a real date.
    pub fn parse(s: &str) -> Option<Ymd> {
        let b = s.as_bytes();
        let shaped =
            b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
        if !shaped {
            return None;
        }
        Ymd::new(s[..4].parse().ok()?, s[5..7].parse().ok()?, s[8..].parse().ok()?)
    }

    pub fn ymd(self) -> String {
        format!("{:04}-{:02}-{:02}", self.y, self.m, self.d)
    }
}

/// Whether module `id` is installed and not switched off.
fn module_active(root: &str, id: &str) -> bool {
    let dir = format!("{root}{MODULES}/{id}");
    fsx::is_dir(&dir) && !fsx::exists(&format!("{dir}/disable")) && !fsx::exists(&format!("{dir}/remove"))
}

/// Play Integrity Fork's OS patch date.
pub struct Pif {
    /// The config file it came from.
    pub file: String,
    pub date: Ymd,
}

/// Play Integrity Fork's patch date. `None` when the module isn't installed
/// and enabled; `Err` says why an installed one gives no date.
pub fn pif(root: &str) -> Option<Result<Pif, String>> {
    if !module_active(root, PIF_ID) {
        return None;
    }
    let dir = format!("{root}{MODULES}/{PIF_ID}");
    let Some(file) = PIF_FILES.iter().find(|f| fsx::is_file(&format!("{dir}/{f}"))) else {
        return Some(Err("Play Integrity Fork has no pif.prop or pif.json".to_string()));
    };
    let text = fsx::read_to_string(&format!("{dir}/{file}")).unwrap_or_default();
    let fields = pif_fields(&text);
    // A repeated key: the last one counts, and an empty value is skipped.
    let found = PIF_KEYS.iter().find_map(|k| {
        let (_, v) = fields.iter().rev().find(|(n, _)| n == k)?;
        (!v.trim().is_empty()).then(|| (k, v.trim()))
    });
    Some(match found {
        None => Err(format!("Play Integrity Fork's {file} has no SECURITY_PATCH")),
        Some((key, v)) => match Ymd::parse(v) {
            Some(date) => Ok(Pif {
                file: file.to_string(),
                date,
            }),
            None => Err(format!("Play Integrity Fork's {key} in {file} isn't a YYYY-MM-DD date: {v}")),
        },
    })
}

/// The string entries of a Play Integrity Fork config, read the way it reads
/// them: JSON (comments allowed) if the file is JSON, whatever its name, else
/// `name=value` lines.
fn pif_fields(text: &str) -> Vec<(String, String)> {
    if let Some(v) = json::parse(text, Syntax { hash_comments: false }) {
        return v
            .members()
            .iter()
            .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
            .collect();
    }
    let text = text.replace('\r', "");
    let mut lines: Vec<&str> = text.split('\n').collect();
    // Only lines that end in a newline: a last line without one is not read.
    lines.pop();
    lines
        .into_iter()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let (name, value) = l.split_once('=')?;
            let value = value.split('#').next().unwrap_or("").trim_end_matches(' ');
            Some((name.to_string(), value.to_string()))
        })
        .collect()
}

/// TEESimulator's OS and vendor patch levels as property dates, each with
/// the reason it has none.
pub struct Sim {
    /// The profile that serves Google Play services, or `None` when no
    /// profile does and the levels are the ones harvested from the real TEE.
    pub profile: Option<String>,
    pub system: Result<Ymd, String>,
    pub vendor: Result<Ymd, String>,
}

impl Sim {
    pub fn origin(&self) -> String {
        match &self.profile {
            Some(p) => format!("TEESimulator profile {p}"),
            None => format!("TEESimulator's harvested TEE levels (no profile serves {GMS})"),
        }
    }
}

/// TEESimulator's levels. `None` when the module isn't installed and
/// enabled; `Err` says why an installed one can't be read.
pub fn teesim(root: &str, today: Option<Ymd>) -> Option<Result<Sim, String>> {
    if !module_active(root, TEESIM_ID) {
        return None;
    }
    let hash = Syntax { hash_comments: true };
    let Some(text) = fsx::read_to_string(&format!("{root}{TEESIM_DIR}/config.json")) else {
        return Some(Err("TEESimulator has no config.json".to_string()));
    };
    let Some(config) = json::parse(&text, hash) else {
        return Some(Err("TEESimulator's config.json isn't valid JSON".to_string()));
    };
    let harvest = fsx::read_to_string(&format!("{root}{TEESIM_DIR}/harvested.json")).and_then(|t| json::parse(&t, hash));
    let harvested = |field: &str| -> Option<i64> {
        match harvest.as_ref()?.get(field)? {
            Value::Num(n) | Value::Str(n) => n.trim().parse().ok(),
            _ => None,
        }
    };

    let profiles = config.get("profiles").map(Value::members).unwrap_or(&[]);
    let serving = profiles.iter().find(|(_, p)| {
        p.get("apps")
            .map(Value::items)
            .unwrap_or(&[])
            .iter()
            .any(|a| matches!(a.text().trim(), GMS | "com.google.android.gms@0"))
    });
    // A profile's levels, with the daemon's defaults for one it leaves out.
    // With no profile for Play services its keys go to the real TEE, whose
    // levels are the harvested ones (an empty level).
    let (profile, system, vendor) = match serving {
        Some((id, p)) => {
            let level = |key: &str, default: &str| match p.get("patchLevel").and_then(|l| l.get(key)) {
                Some(v) => v.text(),
                None => default.to_string(),
            };
            (Some(id.clone()), level("system", "today"), level("vendor", "YYYY-MM-05"))
        }
        None => (None, String::new(), String::new()),
    };
    Some(Ok(Sim {
        profile,
        system: patch_level(&system, Level::System, harvested("osPatchLevel"), today),
        vendor: patch_level(&vendor, Level::Vendor, harvested("vendorPatchLevel"), today),
    }))
}

#[derive(Clone, Copy, PartialEq)]
enum Level {
    /// The OS patch level, kept as YYYYMM.
    System,
    /// The vendor patch level, kept as YYYYMMDD.
    Vendor,
}

/// One level of TEESimulator's patch-level language, as its daemon resolves
/// it, turned into the date the matching property should carry. An OS level
/// has only a month: the date is its 1st, or the day a full date names.
fn patch_level(language: &str, level: Level, harvested: Option<i64>, today: Option<Ymd>) -> Result<Ymd, String> {
    let name = if level == Level::System { "system" } else { "vendor" };
    let v = language.trim();
    let (encoded, named) = if v.is_empty() {
        (
            harvested.ok_or(format!("{name} is the harvested level, and there's no harvest yet"))?,
            None,
        )
    } else if v.eq_ignore_ascii_case("no") {
        return Err(format!("{name} is set to no"));
    } else if v.eq_ignore_ascii_case("system_property") {
        return Err(format!("{name} follows the property"));
    } else if v.eq_ignore_ascii_case("today") {
        let t = today.ok_or(format!("{name} is today, and the clock isn't readable"))?;
        let n = if level == Level::System {
            t.y * 100 + t.m
        } else {
            t.y * 10000 + t.m * 100 + t.d
        };
        (n, None)
    } else {
        let resolved = if ["YYYY", "MM", "DD"].iter().any(|t| v.contains(t)) {
            substitute(v, today.ok_or(format!("{name} is {v}, and the clock isn't readable"))?)
        } else {
            v.to_string()
        };
        let n = if level == Level::System {
            to_yyyymm(&resolved)
        } else {
            to_yyyymmdd(&resolved)
        };
        (n.ok_or(format!("{name} isn't a date: {v}"))?, Ymd::parse(&resolved))
    };
    let date = match level {
        Level::System => Ymd::new(encoded / 100, encoded % 100, 1)
            .filter(|_| (0..1_000_000).contains(&encoded))
            .map(|first| named.filter(|n| n.y == first.y && n.m == first.m).unwrap_or(first)),
        Level::Vendor => Ymd::new(encoded / 10000, encoded / 100 % 100, encoded % 100).filter(|_| (0..100_000_000).contains(&encoded)),
    };
    date.ok_or(format!(
        "{name} isn't a date: {}",
        if v.is_empty() { encoded.to_string() } else { v.to_string() }
    ))
}

/// `YYYY` / `MM` / `DD` filled in from today, stepping back a month at a time
/// while the result names a date still ahead, for at most a year.
fn substitute(v: &str, today: Ymd) -> String {
    let fill = |y: i64, m: i64| {
        v.replace("YYYY", &format!("{y:04}"))
            .replace("MM", &format!("{m:02}"))
            .replace("DD", &format!("{:02}", today.d))
    };
    let (mut y, mut m) = (today.y, today.m);
    for _ in 0..12 {
        let candidate = fill(y, m);
        if !names_future(&candidate, today) {
            return candidate;
        }
        (y, m) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
    }
    fill(today.y, today.m)
}

/// Whether `s` (YYYY-MM-DD or YYYY-MM) names a real date after `today`.
fn names_future(s: &str, today: Ymd) -> bool {
    let n: String = s.chars().filter(|&c| c != '-').collect();
    if n.is_empty() || !n.bytes().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let num = |a: usize, b: usize| n[a..b].parse::<i64>().unwrap_or(-1);
    let date = match n.len() {
        8 => Ymd::new(num(0, 4), num(4, 6), num(6, 8)),
        6 => Ymd::new(num(0, 4), num(4, 6), 1),
        _ => None,
    };
    date.is_some_and(|d| d > today)
}

/// "2025-11-05" or "202511" -> 202511.
fn to_yyyymm(s: &str) -> Option<i64> {
    let head: String = s.chars().filter(|&c| c != '-').take(6).collect();
    (head.len() == 6 && head.bytes().all(|c| c.is_ascii_digit())).then(|| head.parse().ok())?
}

/// "2025-11-05" -> 20251105, "2025-11" -> 20251101.
fn to_yyyymmdd(s: &str) -> Option<i64> {
    let n: String = s.chars().filter(|&c| c != '-').collect();
    if !n.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    match n.len() {
        8 => n.parse().ok(),
        6 => n.parse::<i64>().ok().map(|v| v * 100 + 1),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> Option<Ymd> {
        Ymd::parse(s)
    }

    fn lvl(lang: &str, level: Level, harvested: Option<i64>, today: &str) -> Result<String, String> {
        patch_level(lang, level, harvested, day(today)).map(Ymd::ymd)
    }

    #[test]
    fn dates() {
        assert!(day("2024-02-29").is_some());
        assert!(day("2026-02-29").is_none());
        assert!(day("2026-13-01").is_none());
        assert!(day("2026-1-01").is_none());
        assert!(day(" 2026-01-01").is_none());
        assert!(Ymd::new(2000, 2, 29).is_some() && Ymd::new(1900, 2, 29).is_none());
    }

    #[test]
    fn templates_step_back_until_not_ahead() {
        let t = day("2026-11-03").unwrap();
        assert_eq!(substitute("YYYY-MM-05", t), "2026-10-05");
        assert_eq!(substitute("YYYY-MM-05", day("2026-11-05").unwrap()), "2026-11-05");
        assert_eq!(substitute("YYYY-MM-05", day("2026-01-04").unwrap()), "2025-12-05");
        assert_eq!(substitute("YYYY-MM-DD", t), "2026-11-03");
        assert_eq!(substitute("YYYY-MM", t), "2026-11");
        assert_eq!(substitute("YYYY-12-05", t), "2025-12-05");
        // A day the month lacks isn't a date, so it never counts as ahead; the
        // level is then refused as not a date.
        assert_eq!(substitute("YYYY-MM-31", day("2026-03-01").unwrap()), "2026-02-31");
        assert!(patch_level("YYYY-MM-31", Level::Vendor, None, day("2026-03-01")).is_err());
        // Nothing within a year fits: the plain substitution.
        assert_eq!(substitute("2099-MM-05", t), "2099-11-05");
    }

    #[test]
    fn language() {
        let today = "2026-11-09";
        assert_eq!(lvl("today", Level::System, None, today), Ok("2026-11-01".into()));
        assert_eq!(lvl("TODAY", Level::Vendor, None, today), Ok("2026-11-09".into()));
        assert_eq!(lvl(" YYYY-MM-05 ", Level::Vendor, None, today), Ok("2026-11-05".into()));
        assert_eq!(lvl("YYYY-MM-05", Level::System, None, "2026-11-02"), Ok("2026-10-05".into()));
        assert_eq!(lvl("2025-10-05", Level::System, None, today), Ok("2025-10-05".into()));
        assert_eq!(lvl("2025-10", Level::System, None, today), Ok("2025-10-01".into()));
        assert_eq!(lvl("2025-10", Level::Vendor, None, today), Ok("2025-10-01".into()));
        assert_eq!(lvl("20251005", Level::Vendor, None, today), Ok("2025-10-05".into()));
        assert_eq!(lvl("", Level::System, Some(202509), today), Ok("2025-09-01".into()));
        assert_eq!(lvl("", Level::Vendor, Some(20250905), "bad"), Ok("2025-09-05".into()));
        assert!(lvl("", Level::Vendor, None, today).unwrap_err().contains("no harvest"));
        assert!(lvl("no", Level::System, None, today).unwrap_err().contains("set to no"));
        assert!(lvl("system_property", Level::Vendor, None, today).unwrap_err().contains("follows"));
        assert!(lvl("today", Level::System, None, "bad").unwrap_err().contains("clock"));
        assert!(lvl("YYYY-MM-05", Level::Vendor, None, "bad").unwrap_err().contains("clock"));
        assert!(lvl("2025-13-05", Level::Vendor, None, today).is_err());
        assert!(lvl("soon", Level::System, None, today).is_err());
        assert!(lvl("", Level::Vendor, Some(0), today).is_err());
    }

    #[test]
    fn pif_lines() {
        let f = pif_fields("A=1\r\n#SECURITY_PATCH=2020-01-01\n\nSECURITY_PATCH=2025-10-05  # note\nnoequals\nLAST=unterminated");
        assert_eq!(
            f,
            [
                ("A".to_string(), "1".to_string()),
                ("SECURITY_PATCH".to_string(), "2025-10-05".to_string())
            ]
        );
        let j = pif_fields("// c\n{\"SECURITY_PATCH\": \"2025-10-05\", \"n\": 1}");
        assert_eq!(j, [("SECURITY_PATCH".to_string(), "2025-10-05".to_string())]);
    }
}
