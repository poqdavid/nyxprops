//! A small JSON reader for the config files of other modules (Play Integrity
//! Fork, TEESimulator). It reads standard JSON plus the comments those
//! modules' own parsers accept, and keeps object keys in file order.

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    /// A number, as written.
    Num(String),
    Str(String),
    Arr(Vec<Value>),
    Obj(Vec<(String, Value)>),
}

impl Value {
    /// The member `key` of an object. With a repeated key the last one wins,
    /// as in the parsers this mirrors.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(members) => members.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    /// The object's members in file order, or none for any other value.
    pub fn members(&self) -> &[(String, Value)] {
        match self {
            Value::Obj(m) => m,
            _ => &[],
        }
    }

    pub fn items(&self) -> &[Value] {
        match self {
            Value::Arr(a) => a,
            _ => &[],
        }
    }

    /// The value as Android's `JSONObject.optString` gives it: a string as
    /// is, a number or boolean as written, `null` as "null".
    pub fn text(&self) -> String {
        match self {
            Value::Null => "null".to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Num(n) => n.clone(),
            Value::Str(s) => s.clone(),
            Value::Arr(_) | Value::Obj(_) => String::new(),
        }
    }
}

/// Which comments to skip besides `//` and `/* */`.
#[derive(Clone, Copy)]
pub struct Syntax {
    /// `#` to the end of the line, as Android's org.json reads.
    pub hash_comments: bool,
}

const MAX_DEPTH: usize = 64;

/// Parses `text` as one JSON value, or `None` if it isn't one.
pub fn parse(text: &str, syntax: Syntax) -> Option<Value> {
    let mut p = Parser {
        s: text.as_bytes(),
        i: 0,
        syntax,
    };
    let v = p.value(0)?;
    p.skip_space()?;
    if p.i == p.s.len() {
        Some(v)
    } else {
        None
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    syntax: Syntax,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    /// Skips whitespace and comments. `None` for a comment left open.
    fn skip_space(&mut self) -> Option<()> {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\n' | b'\r') => self.i += 1,
                Some(b'/') if self.s.get(self.i + 1) == Some(&b'/') => self.skip_line(),
                Some(b'#') if self.syntax.hash_comments => self.skip_line(),
                Some(b'/') if self.s.get(self.i + 1) == Some(&b'*') => {
                    let end = self.s[self.i + 2..].windows(2).position(|w| w == b"*/")?;
                    self.i += 2 + end + 2;
                }
                _ => return Some(()),
            }
        }
    }

    fn skip_line(&mut self) {
        while let Some(c) = self.peek() {
            self.i += 1;
            if c == b'\n' {
                break;
            }
        }
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space()?;
        match self.peek()? {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => self.string().map(Value::Str),
            b't' => self.literal("true", Value::Bool(true)),
            b'f' => self.literal("false", Value::Bool(false)),
            b'n' => self.literal("null", Value::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => None,
        }
    }

    fn literal(&mut self, word: &str, v: Value) -> Option<Value> {
        if self.s[self.i..].starts_with(word.as_bytes()) {
            self.i += word.len();
            Some(v)
        } else {
            None
        }
    }

    fn number(&mut self) -> Option<Value> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        let int = self.digits();
        if int == 0 || (int > 1 && self.s[self.i - int] == b'0') {
            return None;
        }
        if self.peek() == Some(b'.') {
            self.i += 1;
            if self.digits() == 0 {
                return None;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if self.digits() == 0 {
                return None;
            }
        }
        Some(Value::Num(String::from_utf8_lossy(&self.s[start..self.i]).into_owned()))
    }

    fn digits(&mut self) -> usize {
        let start = self.i;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.i += 1;
        }
        self.i - start
    }

    fn string(&mut self) -> Option<String> {
        self.i += 1; // the opening quote
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = self.peek()?;
            self.i += 1;
            match c {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let e = self.peek()?;
                    self.i += 1;
                    match e {
                        b'"' | b'\\' | b'/' => out.push(e),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0c),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xD800..0xDC00).contains(&cp) && self.s[self.i..].starts_with(b"\\u") {
                                self.i += 2;
                                let lo = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&lo) {
                                    return None;
                                }
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                            }
                            let ch = char::from_u32(cp)?;
                            out.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        _ => return None,
                    }
                }
                0x00..=0x1f => return None,
                _ => out.push(c),
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let h = self.s.get(self.i..self.i + 4)?;
        let v = u32::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok()?;
        self.i += 4;
        Some(v)
    }

    fn array(&mut self, depth: usize) -> Option<Value> {
        self.i += 1;
        let mut items = Vec::new();
        self.skip_space()?;
        if self.peek() == Some(b']') {
            self.i += 1;
            return Some(Value::Arr(items));
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.skip_space()?;
            match self.peek()? {
                b',' => self.i += 1,
                b']' => {
                    self.i += 1;
                    return Some(Value::Arr(items));
                }
                _ => return None,
            }
        }
    }

    fn object(&mut self, depth: usize) -> Option<Value> {
        self.i += 1;
        let mut members = Vec::new();
        self.skip_space()?;
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Some(Value::Obj(members));
        }
        loop {
            self.skip_space()?;
            if self.peek()? != b'"' {
                return None;
            }
            let key = self.string()?;
            self.skip_space()?;
            if self.peek()? != b':' {
                return None;
            }
            self.i += 1;
            let v = self.value(depth + 1)?;
            members.push((key, v));
            self.skip_space()?;
            match self.peek()? {
                b',' => self.i += 1,
                b'}' => {
                    self.i += 1;
                    return Some(Value::Obj(members));
                }
                _ => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STRICT: Syntax = Syntax { hash_comments: false };
    const HASH: Syntax = Syntax { hash_comments: true };

    #[test]
    fn values() {
        let v = parse(
            r#" { "a": "x\"y\u00e9\ud83d\ude00", "n": -12.5e3, "t": true, "z": null, "arr": [1, [], {}], "a": "last" } "#,
            STRICT,
        )
        .unwrap();
        assert_eq!(v.get("a").and_then(Value::as_str), Some("last"));
        assert_eq!(v.get("n").map(Value::text).as_deref(), Some("-12.5e3"));
        assert_eq!(v.get("t").map(Value::text).as_deref(), Some("true"));
        assert_eq!(v.get("z").map(Value::text).as_deref(), Some("null"));
        assert_eq!(v.get("arr").map(|a| a.items().len()), Some(3));
        assert_eq!(v.members()[0].1, Value::Str("x\"y\u{e9}\u{1f600}".to_string()));
        assert_eq!(
            v.members().iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
            ["a", "n", "t", "z", "arr", "a"]
        );
    }

    #[test]
    fn comments() {
        let text = "// head\n{ /* inline */ \"a\": 1, // tail\n \"b\": 2 }\n";
        assert_eq!(parse(text, STRICT).and_then(|v| v.get("b").map(Value::text)).as_deref(), Some("2"));
        assert!(parse("# hash\n{\"a\": 1}", STRICT).is_none());
        assert!(parse("# hash\n{\"a\": 1}", HASH).is_some());
        assert!(parse("{\"a\": 1} /* open", STRICT).is_none());
    }

    #[test]
    fn rejects() {
        for bad in [
            "",
            "{",
            "{\"a\" 1}",
            "{\"a\": 1,}",
            "[1,]",
            "{a: 1}",
            "\"tab\there\"",
            "01",
            "1.",
            "-",
            "nul",
            "{} {}",
            "MANUFACTURER=Google\n",
            "\"\\x\"",
        ] {
            assert!(parse(bad, STRICT).is_none(), "{bad:?}");
        }
        let deep = "[".repeat(100) + &"]".repeat(100);
        assert!(parse(&deep, STRICT).is_none());
    }
}
