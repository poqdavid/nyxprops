#!/bin/sh
MODDIR=${0%/*}
. ${MODDIR}/utils.sh
PERSISTENT_DIR=/data/adb/nyxprops
PROPS_DIR=${PERSISTENT_DIR}/props
tmpfolder=/data/adb/ksu/nyxprops
logfile1="$tmpfolder/logs/props.log"

mkdir -p $tmpfolder/logs

[ -f $PERSISTENT_DIR/config.sh ] && . $PERSISTENT_DIR/config.sh

resetprop -w sys.boot_completed 0

vbmeta_size=$(sed -n 's/^vbmeta_size=//p' ${PERSISTENT_DIR}/config.sh 2> /dev/null)
vbmeta_size=${vbmeta_size:-8192}

nyx_resolve_avb_version
nyx_resolve_prop_dates

nyx_prop_tool_init "${prop_tool:-magisk}"
nyx_init_boot_log
nyx_apply_prop_presets "$PROPS_DIR" service

if nyx_rp_needs_rebuild; then
    nyx_rebuild_touched_areas "${hide_compact:-area}"
fi
