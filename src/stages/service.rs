use super::{props_dir, setup};
use crate::tools;

pub fn run(moddir: &str) {
    tools::resetprop_w("sys.boot_completed", "0");

    let (mut engine, vars) = setup(moddir);
    engine.apply_presets(&props_dir(), "service");
    if engine.be.needs_rebuild() {
        engine.rebuild_touched_areas(vars.get("hide_compact"));
    }
}
