use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn append_line(path: &str, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(format!("{line}\n").as_bytes());
    }
}

pub fn mkdir_p(path: &str) {
    let _ = fs::create_dir_all(path);
}

pub fn is_file(path: &str) -> bool {
    Path::new(path).is_file()
}

pub fn is_dir(path: &str) -> bool {
    Path::new(path).is_dir()
}

pub fn basename(path: &str) -> &str {
    let t = path.trim_end_matches('/');
    t.rsplit('/').next().unwrap_or(t)
}

pub fn dirname(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some(("", _)) => "/",
        Some((d, _)) => d,
        None => ".",
    }
}

pub fn glob_props(dir: &str) -> Vec<String> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with('.') && n.ends_with(".prop"))
        .collect();
    names.sort();
    names.into_iter().map(|n| format!("{dir}/{n}")).collect()
}

pub fn read_to_string(path: &str) -> Option<String> {
    fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn write(path: &str, contents: &str) -> bool {
    fs::write(path, contents).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(basename("/a/b/c.prop"), "c.prop");
        assert_eq!(basename("x"), "x");
        assert_eq!(dirname("/a/b/c"), "/a/b");
        assert_eq!(dirname("x"), ".");
    }
}
