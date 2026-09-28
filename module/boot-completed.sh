#!/system/bin/sh
# boot-completed stage. KernelSU runs this script by name; the work is done by
# bin/nyxprops (src/stages/).
MODDIR=${0%/*}
# Probe first: a failed exec ends the script on the spot, so the fallback
# below would never run.
if "$MODDIR/bin/nyxprops" --version > /dev/null 2>&1; then
    exec "$MODDIR/bin/nyxprops" stage boot-completed
fi
# Reached only if the binary can't run (missing, not executable or built
# for another CPU): log it and exit 0 so a broken binary never causes a
# bootloop.
mkdir -p /data/adb/ksu/nyxprops/logs
echo "nyxprops/boot-completed: [error] bin/nyxprops failed to exec" >> /data/adb/ksu/nyxprops/logs/props.log
exit 0
