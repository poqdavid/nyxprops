use super::{count_presets, props_dir, setup};
use crate::backend::Mode;
use crate::{fsx, repeat};

pub fn run(moddir: &str) {
    let props = props_dir();
    let (mut engine, vars) = setup(moddir);
    engine.apply_presets(&props, "boot-completed");
    if engine.be.needs_rebuild() {
        engine.rebuild_touched_areas(vars.get("hide_compact"));
    }

    repeat::start(&engine, vars.get("repeat_enabled"), vars.get("repeat_min_interval"), &props);

    let (total, enabled) = count_presets(&props);
    let status_txt = if total == 0 { "❌ No presets found" } else { "✅ Active" };
    let backend_txt = match engine.be.mode {
        Mode::Rs => "resetprop-rs",
        Mode::Magisk => "stock resetprop",
    };
    let description = format!("[{status_txt}] {enabled}/{total} presets enabled · {backend_txt} — details in the WebUI");
    set_module_description(moddir, &description);
}

fn set_module_description(moddir: &str, description: &str) {
    let path = format!("{moddir}/module.prop");
    let Some(text) = fsx::read_to_string(&path) else { return };
    let trailing = text.ends_with('\n');
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    if trailing {
        lines.pop();
    }
    let mut done = false;
    for l in lines.iter_mut() {
        if l.starts_with("description=") {
            *l = format!("description={description}");
            done = true;
            break;
        }
    }
    if !done {
        lines.push(format!("description={description}"));
    }
    let mut out = lines.join("\n");
    if trailing || !done {
        out.push('\n');
    }
    fsx::write(&path, &out);
}
