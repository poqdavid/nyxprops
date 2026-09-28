#!/bin/sh
MODDIR=${0%/*}
. ${MODDIR}/utils.sh
PERSISTENT_DIR=/data/adb/nyxprops
PROPS_DIR=${PERSISTENT_DIR}/props
tmpfolder=/data/adb/ksu/nyxprops
logfile1="$tmpfolder/logs/props.log"

mkdir -p $tmpfolder/logs

[ -f $PERSISTENT_DIR/config.sh ] && . $PERSISTENT_DIR/config.sh

vbmeta_size=$(sed -n 's/^vbmeta_size=//p' ${PERSISTENT_DIR}/config.sh 2> /dev/null)
vbmeta_size=${vbmeta_size:-8192}
nyx_resolve_avb_version
nyx_resolve_prop_dates
nyx_prop_tool_init "${prop_tool:-magisk}"
nyx_init_boot_log
nyx_apply_prop_presets "$PROPS_DIR" boot-completed
if nyx_rp_needs_rebuild; then
    nyx_rebuild_touched_areas "${hide_compact:-area}"
fi

nyx_start_repeat_loop "$PROPS_DIR"

nyx_presets_total=0
nyx_presets_enabled=0
for _p in "$PROPS_DIR"/*.prop; do
    [ -f "$_p" ] || continue
    nyx_presets_total=$((nyx_presets_total + 1))
    _en=$(sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$_p" | head -n 1)
    [ -z "$_en" ] && _en=1
    [ "$_en" = "1" ] && nyx_presets_enabled=$((nyx_presets_enabled + 1))
done

if [ "$nyx_presets_total" = 0 ]; then
    status_txt="❌ No presets found"
else
    status_txt="✅ Active"
fi

if [ "$NYX_RP_MODE" = "rs" ]; then
    backend_txt="resetprop-rs"
else
    backend_txt="stock resetprop"
fi

description="[${status_txt}] ${nyx_presets_enabled}/${nyx_presets_total} presets enabled · ${backend_txt} — details in the WebUI"
NYX_DESC="$description" awk '
BEGIN { done = 0; d = ENVIRON["NYX_DESC"] }
done == 0 && /^description=/ { print "description=" d; done = 1; next }
{ print }
END { if (done == 0) print "description=" d }
' "$MODDIR/module.prop" > "$MODDIR/module.prop.nyxtmp" \
    && mv "$MODDIR/module.prop.nyxtmp" "$MODDIR/module.prop"
