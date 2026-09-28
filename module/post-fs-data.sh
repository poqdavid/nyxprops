#!/bin/sh
MODDIR=${0%/*}
. ${MODDIR}/utils.sh
PERSISTENT_DIR=/data/adb/nyxprops
PROPS_DIR=${PERSISTENT_DIR}/props
tmpfolder=/data/adb/ksu/nyxprops
logfile1="$tmpfolder/logs/props.log"

mkdir -p $tmpfolder/logs

# This stage runs BEFORE zygote. Build-identity props the framework bakes
# into android.os.Build static fields (ro.build.type, ro.build.fingerprint,
# ro.build.version.security_patch, ro.debuggable, ...) must be set here, not
# at the service stage, or the Java constant keeps the pre-spoof value while
# the raw property reads the new one - a JVM-vs-native divergence a detector
# can see. Presets choose this with `# stage: post-fs-data`.

[ -f $PERSISTENT_DIR/config.sh ] && . $PERSISTENT_DIR/config.sh

vbmeta_size=$(sed -n 's/^vbmeta_size=//p' ${PERSISTENT_DIR}/config.sh 2> /dev/null)
vbmeta_size=${vbmeta_size:-8192}

nyx_resolve_avb_version
nyx_resolve_prop_dates

nyx_prop_tool_init "${prop_tool:-magisk}"
nyx_init_boot_log
nyx_apply_prop_presets "$PROPS_DIR" post-fs-data

if nyx_rp_needs_rebuild; then
    nyx_rebuild_touched_areas "${hide_compact:-area}"
fi
