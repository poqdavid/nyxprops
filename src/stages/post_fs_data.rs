use super::{init_boot_log, props_dir, setup};

pub fn run(moddir: &str) {
    let (mut engine, vars) = setup(moddir);
    init_boot_log(&engine);
    engine.apply_presets(&props_dir(), "post-fs-data");
    if engine.be.needs_rebuild() {
        engine.rebuild_touched_areas(vars.get("hide_compact"));
    }
}
