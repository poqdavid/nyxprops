pub fn int(s: &str) -> Option<i64> {
    let t = s.trim_matches(|c| c == ' ' || c == '\t' || c == '\n');
    let digits = t.strip_prefix(['-', '+']).unwrap_or(t);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    t.parse().ok()
}

pub fn gt(s: &str, n: i64) -> bool {
    int(s).is_some_and(|v| v > n)
}

pub fn lt(s: &str, n: i64) -> bool {
    int(s).is_some_and(|v| v < n)
}

pub fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

pub fn strip_newlines(mut s: String) -> String {
    while s.ends_with('\n') {
        s.pop();
    }
    s
}

pub fn fields(line: &str) -> Vec<&str> {
    line.split([' ', '\t', '\n']).filter(|w| !w.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int_parsing() {
        assert_eq!(int("2"), Some(2));
        assert_eq!(int(" -1 "), Some(-1));
        assert_eq!(int("+5"), Some(5));
        assert_eq!(int(""), None);
        assert_eq!(int("2.3"), None);
        assert!(gt("36", 35) && !gt("35", 35));
        assert!(lt("34", 35));
    }

    #[test]
    fn digit_guard() {
        assert!(is_digits("34") && !is_digits("") && !is_digits("3a"));
    }

    #[test]
    fn field_split() {
        assert_eq!(fields("reset  ro.x   val"), ["reset", "ro.x", "val"]);
        assert_eq!(fields("  a\tb "), ["a", "b"]);
        assert!(fields("   ").is_empty());
    }
}
