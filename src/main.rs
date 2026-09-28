mod backend;
mod config;
mod dates;
mod engine;
mod fsx;
mod repeat;
mod stages;
mod text;
mod tools;

use std::path::Path;
use std::process::ExitCode;

const MODDIR_FALLBACK: &str = "/data/adb/modules/nyxprops";

fn moddir(argv0: &str) -> String {
    let p = Path::new(argv0);
    match p.parent().and_then(Path::parent) {
        Some(d) if !d.as_os_str().is_empty() && p.parent().is_some_and(|b| b.ends_with("bin")) => d.to_string_lossy().into_owned(),
        _ => MODDIR_FALLBACK.to_string(),
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: nyxprops stage <post-fs-data|service|boot-completed>\n       nyxprops --version");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    tools::prepend_ksu_path();
    let argv0 = args.first().map(String::as_str).unwrap_or("");
    let a1 = args.get(1).map(String::as_str);
    let a2 = args.get(2).map(String::as_str);
    match (a1, a2) {
        (Some("--version"), _) => {
            println!("nyxprops {}", option_env!("NYX_MODULE_VERSION").unwrap_or("unknown"));
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("post-fs-data")) => {
            stages::post_fs_data::run(&moddir(argv0));
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("service")) => {
            stages::service::run(&moddir(argv0));
            ExitCode::SUCCESS
        }
        (Some("stage"), Some("boot-completed")) => {
            stages::boot_completed::run(&moddir(argv0));
            ExitCode::SUCCESS
        }
        (Some("__repeat"), Some(md)) => {
            let fallback = stages::props_dir();
            let dir = args.get(3).map(String::as_str).unwrap_or(&fallback);
            let base: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(30);
            repeat::worker(md, dir, base);
            ExitCode::SUCCESS
        }
        _ => usage(),
    }
}

#[cfg(test)]
mod tests {
    use super::moddir;

    #[test]
    fn moddir_from_binary_path() {
        assert_eq!(moddir("/data/adb/modules/nyxprops/bin/nyxprops"), "/data/adb/modules/nyxprops");
        assert_eq!(
            moddir("/data/adb/modules_update/nyxprops/bin/nyxprops"),
            "/data/adb/modules_update/nyxprops"
        );
        assert_eq!(moddir("nyxprops"), "/data/adb/modules/nyxprops");
    }
}
