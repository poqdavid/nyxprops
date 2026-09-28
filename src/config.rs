use std::collections::HashMap;
use std::fs;

#[derive(Default, Clone)]
pub struct Vars(HashMap<String, String>);

impl Vars {
    pub fn with_defaults(defaults: &[(&str, &str)]) -> Self {
        Vars(defaults.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect())
    }

    pub fn source(&mut self, path: &str) {
        if let Ok(text) = fs::read_to_string(path) {
            self.source_str(&text);
        }
    }

    pub fn source_str(&mut self, text: &str) {
        for line in text.lines() {
            if let Some((k, v)) = parse_assignment(line) {
                self.0.insert(k, v);
            }
        }
    }

    pub fn get(&self, key: &str) -> &str {
        self.0.get(key).map(String::as_str).unwrap_or("")
    }
}

fn parse_assignment(line: &str) -> Option<(String, String)> {
    let line = line.trim_start_matches([' ', '\t']);
    let eq = line.find('=')?;
    let name = &line[..eq];
    let mut chars = name.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some((name.to_string(), parse_word(&line[eq + 1..])))
}

fn parse_word(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            ' ' | '\t' | ';' | '\r' => break,
            '\'' => {
                for q in it.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    out.push(q);
                }
            }
            '"' => {
                while let Some(q) = it.next() {
                    match q {
                        '"' => break,
                        '\\' => match it.peek() {
                            Some('"') | Some('\\') | Some('$') | Some('`') => out.push(it.next().unwrap_or('\\')),
                            Some('\n') => {
                                it.next();
                            }
                            _ => out.push('\\'),
                        },
                        _ => out.push(q),
                    }
                }
            }
            '\\' => {
                if let Some(n) = it.next() {
                    out.push(n);
                }
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assignments() {
        let mut v = Vars::default();
        v.source_str(
            "# comment\nsusfs_log=1\nkernel_version='5.10 x'\nkernel_build=\"a \\\"b\\\"\"\nhide=1 # trailing\n  spaced=2\nsus_su=-1\nsus_su=2\nesc='it'\\''s'\nempty=\n9bad=1\nnot an assignment\n",
        );
        assert_eq!(v.get("susfs_log"), "1");
        assert_eq!(v.get("kernel_version"), "5.10 x");
        assert_eq!(v.get("kernel_build"), "a \"b\"");
        assert_eq!(v.get("hide"), "1");
        assert_eq!(v.get("spaced"), "2");
        assert_eq!(v.get("sus_su"), "2");
        assert_eq!(v.get("esc"), "it's");
        assert_eq!(v.get("empty"), "");
        assert_eq!(v.get("9bad"), "");
        assert_eq!(v.get("missing"), "");
    }
}
