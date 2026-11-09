use crate::tee::{self, Ymd};
use crate::tools::capture;

#[derive(Default, Clone)]
pub struct Dates {
    pub security_patch: String,
    pub yyyy_mm: String,
    pub vendor_patch: String,
    /// Where `security_patch` and `vendor_patch` came from, as log lines
    /// (tag, text). Empty when both are the clock's and nothing was amiss.
    pub notes: Vec<(&'static str, String)>,
}

impl Dates {
    pub fn resolve() -> Self {
        Self::resolve_in("", &capture("date", &["+%Y-%m-%d"]))
    }

    /// The date tokens on `today`, for a device whose files are under
    /// `root` ("" on a device).
    ///
    /// `{security_patch}` and `{vendor_patch}` follow the patch levels the
    /// TEE reports, so the properties and key attestation agree: Play
    /// Integrity Fork's SECURITY_PATCH for both if it's installed, as its own
    /// sync gives every TEE level that date; else TEESimulator's levels;
    /// else the calendar. A level a source leaves out comes from the
    /// calendar. `{yyyy_mm}` is always the current month.
    pub fn resolve_in(root: &str, today: &str) -> Self {
        let mut d = Self::from_ymd(today);
        let today = Ymd::parse(today);
        let sim = tee::teesim(root, today);
        match tee::pif(root) {
            Some(Ok(p)) => {
                let date = p.date.ymd();
                for token in ["security_patch", "vendor_patch"] {
                    d.notes
                        .push(("prop_dates", format!("{token}={date} from Play Integrity Fork ({})", p.file)));
                }
                if let Some(Ok(s)) = &sim {
                    d.note_mismatch(s, p.date);
                }
                d.security_patch = date.clone();
                d.vendor_patch = date;
                return d;
            }
            Some(Err(why)) => {
                let next = if matches!(sim, Some(Ok(_))) { "TEESimulator" } else { "the clock" };
                d.notes.push(("prop_dates_warn", format!("{why}; using {next}")));
            }
            None => {}
        }
        match sim {
            Some(Ok(s)) => {
                let origin = s.origin();
                for (token, level, clock) in [
                    ("security_patch", &s.system, &mut d.security_patch),
                    ("vendor_patch", &s.vendor, &mut d.vendor_patch),
                ] {
                    let line = match level {
                        Ok(date) => {
                            *clock = date.ymd();
                            format!("{token}={clock} from {origin}")
                        }
                        Err(why) => {
                            let shown = if clock.is_empty() { "(none)" } else { clock.as_str() };
                            format!("{token}={shown} from the clock: {origin}: {why}")
                        }
                    };
                    d.notes.push(("prop_dates", line));
                }
            }
            Some(Err(why)) => d.notes.push(("prop_dates_warn", format!("{why}; using the clock"))),
            None => {}
        }
        d
    }

    /// Warns when TEESimulator reports other levels than Play Integrity
    /// Fork's date. The OS level only has a month to compare.
    fn note_mismatch(&mut self, s: &tee::Sim, pif: Ymd) {
        let system = s.system.as_ref().ok().filter(|t| (t.y, t.m) != (pif.y, pif.m));
        let vendor = s.vendor.as_ref().ok().filter(|t| **t != pif);
        if system.is_none() && vendor.is_none() {
            return;
        }
        let mut differ = Vec::new();
        if let Some(t) = system {
            differ.push(format!("system {:04}-{:02}", t.y, t.m));
        }
        if let Some(t) = vendor {
            differ.push(format!("vendor {}", t.ymd()));
        }
        self.notes.push((
            "prop_dates_warn",
            format!(
                "{} reports {}, not Play Integrity Fork's {}; set its patch levels to match",
                s.origin(),
                differ.join(" and "),
                pif.ymd()
            ),
        ));
    }

    pub fn from_ymd(s: &str) -> Self {
        let b = s.as_bytes();
        let shaped = b.len() == 10
            && b[..4].iter().all(u8::is_ascii_digit)
            && b[4] == b'-'
            && b[5..7].iter().all(u8::is_ascii_digit)
            && b[7] == b'-'
            && b[8..10].iter().all(u8::is_ascii_digit);
        if !shaped {
            return Dates::default();
        }
        let yyyy_mm = s[..7].to_string();
        let security_patch = format!("{yyyy_mm}-01");

        let mut y: i64 = s[..4].parse().unwrap_or(0);
        let mut m: i64 = s[5..7].parse().unwrap_or(0);
        let d: i64 = s[8..10].parse().unwrap_or(5);
        if d < 5 {
            if m <= 1 {
                y -= 1;
                m = 12;
            } else {
                m -= 1;
            }
        }
        let vendor_patch = format!("{y:04}-{m:02}-05");
        // Reject anything that is not a well-formed YYYY-MM-05.
        let vb = vendor_patch.as_bytes();
        let valid = vb.len() == 10 && vendor_patch.ends_with("-05") && vb[4] == b'-' && vb[7] == b'-';
        Dates {
            security_patch,
            yyyy_mm,
            vendor_patch: if valid { vendor_patch } else { String::new() },
            notes: Vec::new(),
        }
    }
}

pub fn resolve_avb_version(configured: &str) -> String {
    let v = if configured.is_empty() { "auto" } else { configured };
    if v != "auto" {
        return v.to_string();
    }
    let mut got = capture("resetprop", &["ro.boot.avb_version"]);
    if got.is_empty() {
        got = capture("resetprop", &["ro.boot.vbmeta.avb_version"]);
    }
    if got.is_empty() {
        "1.2".to_string()
    } else {
        got
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_tokens_and_rollback() {
        let d = Dates::from_ymd("2026-10-05");
        assert_eq!(
            (d.security_patch.as_str(), d.yyyy_mm.as_str(), d.vendor_patch.as_str()),
            ("2026-10-01", "2026-10", "2026-10-05")
        );
        assert_eq!(Dates::from_ymd("2026-10-02").vendor_patch, "2026-09-05");
        assert_eq!(Dates::from_ymd("2026-01-03").vendor_patch, "2025-12-05");
        assert_eq!(Dates::from_ymd("2026-01-05").vendor_patch, "2026-01-05");
        assert_eq!(Dates::from_ymd("2026-12-01").vendor_patch, "2026-11-05");
    }

    #[test]
    fn bad_clock_empties_all() {
        let d = Dates::from_ymd("nope");
        assert!(d.security_patch.is_empty() && d.yyyy_mm.is_empty() && d.vendor_patch.is_empty());
    }

    /// A fake device root holding `files` (path -> contents; a path ending
    /// in '/' is a directory).
    struct Root(std::path::PathBuf);

    impl Root {
        fn new(name: &str, files: &[(&str, &str)]) -> Root {
            let dir = std::env::temp_dir().join(format!("nyxprops-dates-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            for (path, text) in files {
                let full = dir.join(path.trim_start_matches('/'));
                if path.ends_with('/') {
                    std::fs::create_dir_all(&full).unwrap();
                } else {
                    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                    std::fs::write(&full, text).unwrap();
                }
            }
            std::fs::create_dir_all(&dir).unwrap();
            Root(dir)
        }

        fn dates(&self, today: &str) -> Dates {
            Dates::resolve_in(&self.0.to_string_lossy(), today)
        }
    }

    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PIF: &str = "/data/adb/modules/playintegrityfix";
    const SIM: &str = "/data/adb/modules/teesim/";
    const SIM_CONFIG: &str = "/data/adb/teesim/config.json";
    const SIM_HARVEST: &str = "/data/adb/teesim/harvested.json";

    fn pair(d: &Dates) -> (&str, &str) {
        (d.security_patch.as_str(), d.vendor_patch.as_str())
    }

    fn notes(d: &Dates) -> Vec<String> {
        d.notes.iter().map(|(t, s)| format!("[{t}] {s}")).collect()
    }

    fn sim_config(system: &str, vendor: &str, apps: &str) -> String {
        format!(
            "{{\"version\": 1, \"profiles\": {{\"other\": {{\"apps\": [\"com.example\"], \"patchLevel\": {{\"system\": \"2020-01\"}}}},
             \"play\": {{\"keybox\": \"keybox.xml\", \"patchLevel\": {{\"system\": \"{system}\", \"vendor\": \"{vendor}\"}}, \"apps\": [{apps}]}}}}}}"
        )
    }

    #[test]
    fn clock_when_neither_module() {
        let r = Root::new("none", &[("/data/adb/modules/other/", "")]);
        let d = r.dates("2026-11-03");
        assert_eq!(pair(&d), ("2026-11-01", "2026-10-05"));
        assert!(d.notes.is_empty());
    }

    #[test]
    fn pif_first() {
        let r = Root::new(
            "pif",
            &[
                (
                    &format!("{PIF}/custom.pif.prop"),
                    "MODEL=Pixel\n#SECURITY_PATCH=2020-01-01\nSECURITY_PATCH=2025-10-05\n",
                ),
                (&format!("{PIF}/pif.json"), "{\"SECURITY_PATCH\": \"2024-01-05\"}"),
                (SIM, ""),
                (SIM_CONFIG, &sim_config("2025-10", "2025-10-05", "\"com.google.android.gms\"")),
            ],
        );
        let d = r.dates("2026-11-09");
        assert_eq!(pair(&d), ("2025-10-05", "2025-10-05"));
        assert_eq!(d.yyyy_mm, "2026-11");
        assert_eq!(
            notes(&d),
            [
                "[prop_dates] security_patch=2025-10-05 from Play Integrity Fork (custom.pif.prop)",
                "[prop_dates] vendor_patch=2025-10-05 from Play Integrity Fork (custom.pif.prop)",
            ]
        );
    }

    #[test]
    fn pif_json_and_mismatch() {
        let r = Root::new(
            "pifjson",
            &[
                (
                    &format!("{PIF}/custom.pif.json"),
                    "// comment\n{\"ro.build.version.security_patch\": \"2025-09-05\"}",
                ),
                (SIM, ""),
                (SIM_CONFIG, &sim_config("today", "YYYY-MM-05", "\"com.google.android.gms@0\"")),
            ],
        );
        let d = r.dates("2026-11-09");
        assert_eq!(pair(&d), ("2025-09-05", "2025-09-05"));
        assert_eq!(
            notes(&d)[2],
            "[prop_dates_warn] TEESimulator profile play reports system 2026-11 and vendor 2026-11-05, \
             not Play Integrity Fork's 2025-09-05; set its patch levels to match"
        );
    }

    #[test]
    fn pif_switched_off_or_empty() {
        let off = Root::new(
            "pifoff",
            &[
                (&format!("{PIF}/disable"), ""),
                (&format!("{PIF}/pif.prop"), "SECURITY_PATCH=2025-10-05\n"),
            ],
        );
        let d = off.dates("2026-11-09");
        assert_eq!(pair(&d), ("2026-11-01", "2026-11-05"));
        assert!(d.notes.is_empty());

        let empty = Root::new(
            "pifempty",
            &[(&format!("{PIF}/pif.prop"), "SECURITY_PATCH=\nro.build.version.security_patch=\n")],
        );
        let d = empty.dates("2026-11-09");
        assert_eq!(pair(&d), ("2026-11-01", "2026-11-05"));
        assert_eq!(
            notes(&d),
            ["[prop_dates_warn] Play Integrity Fork's pif.prop has no SECURITY_PATCH; using the clock"]
        );

        let bad = Root::new(
            "pifbad",
            &[
                (&format!("{PIF}/pif.prop"), "SECURITY_PATCH=2025-10\n"),
                (SIM, ""),
                (SIM_CONFIG, &sim_config("2025-08-05", "2025-08-05", "\"com.google.android.gms\"")),
            ],
        );
        let d = bad.dates("2026-11-09");
        assert_eq!(pair(&d), ("2025-08-05", "2025-08-05"));
        assert_eq!(
            notes(&d)[0],
            "[prop_dates_warn] Play Integrity Fork's SECURITY_PATCH in pif.prop isn't a YYYY-MM-DD date: 2025-10; using TEESimulator"
        );
    }

    #[test]
    fn teesim_profile_for_play_services() {
        let r = Root::new(
            "sim",
            &[
                (SIM, ""),
                (SIM_CONFIG, &sim_config("today", "YYYY-MM-05", "\"com.google.android.gms\"")),
            ],
        );
        let d = r.dates("2026-11-03");
        assert_eq!(pair(&d), ("2026-11-01", "2026-10-05"));
        assert_eq!(
            notes(&d),
            [
                "[prop_dates] security_patch=2026-11-01 from TEESimulator profile play",
                "[prop_dates] vendor_patch=2026-10-05 from TEESimulator profile play",
            ]
        );
        // A profile without patchLevel gets the daemon's defaults.
        let r = Root::new(
            "simdefaults",
            &[
                (SIM, ""),
                (
                    SIM_CONFIG,
                    "{\"profiles\": {\"default\": {\"apps\": [\"com.google.android.gms\"]}}}",
                ),
            ],
        );
        assert_eq!(pair(&r.dates("2026-11-09")), ("2026-11-01", "2026-11-05"));
    }

    #[test]
    fn teesim_harvested_and_fallbacks() {
        let harvest = "{\"version\": 3, \"osPatchLevel\": 202509, \"vendorPatchLevel\": 20250905}";
        // No profile serves Play services: the real TEE's harvested levels.
        let r = Root::new(
            "simharvest",
            &[
                (SIM, ""),
                (SIM_CONFIG, &sim_config("today", "today", "\"com.example.other\"")),
                (SIM_HARVEST, harvest),
            ],
        );
        let d = r.dates("2026-11-09");
        assert_eq!(pair(&d), ("2025-09-01", "2025-09-05"));
        assert!(notes(&d)[0].contains("from TEESimulator's harvested TEE levels (no profile serves com.google.android.gms)"));
        // An empty level is the harvested one too; system_property follows the
        // property, so the clock sets it.
        let r = Root::new(
            "simmixed",
            &[
                (SIM, ""),
                (SIM_CONFIG, &sim_config("", "system_property", "\"com.google.android.gms\"")),
                (SIM_HARVEST, harvest),
            ],
        );
        let d = r.dates("2026-11-09");
        assert_eq!(pair(&d), ("2025-09-01", "2026-11-05"));
        assert_eq!(
            notes(&d)[1],
            "[prop_dates] vendor_patch=2026-11-05 from the clock: TEESimulator profile play: vendor follows the property"
        );
        // No harvest yet and a bad clock: nothing to give.
        let r = Root::new(
            "simnone",
            &[(SIM, ""), (SIM_CONFIG, &sim_config("", "today", "\"com.google.android.gms\""))],
        );
        let d = r.dates("not a date");
        assert_eq!(pair(&d), ("", ""));
        assert_eq!(
            notes(&d),
            [
                "[prop_dates] security_patch=(none) from the clock: TEESimulator profile play: system is the harvested level, and there's no harvest yet",
                "[prop_dates] vendor_patch=(none) from the clock: TEESimulator profile play: vendor is today, and the clock isn't readable",
            ]
        );
        // An unreadable config.
        let r = Root::new("simbroken", &[(SIM, ""), (SIM_CONFIG, "{\"profiles\": ")]);
        let d = r.dates("2026-11-09");
        assert_eq!(pair(&d), ("2026-11-01", "2026-11-05"));
        assert_eq!(
            notes(&d),
            ["[prop_dates_warn] TEESimulator's config.json isn't valid JSON; using the clock"]
        );
    }
}
