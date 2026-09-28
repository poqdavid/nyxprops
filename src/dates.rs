use crate::tools::capture;

#[derive(Default, Clone)]
pub struct Dates {
    pub security_patch: String,
    pub yyyy_mm: String,
    pub vendor_patch: String,
}

impl Dates {
    pub fn resolve() -> Self {
        Self::from_ymd(&capture("date", &["+%Y-%m-%d"]))
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
}
