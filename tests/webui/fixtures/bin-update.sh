#!/system/bin/sh
# Stand-in for module/bin-update.sh: answers from the test root's
# data/adb/nyxtest/bin_mode (uptodate, differs, missing, offline, ...)
# instead of downloading.
mode=$(cat "${NYX_TEST_ROOT}/data/adb/nyxtest/bin_mode" 2> /dev/null || echo uptodate)
sleep 1
case "$1" in
    check)
        echo "status=$mode"
        echo "asset=resetprop-arm64-v8a"
        echo "local=aaaa"
        echo "remote=bbbb"
        echo "latest=v9.9.9"
        echo "detail=stub detail for $mode"
        ;;
    apply)
        echo "status=installed"
        echo "asset=resetprop-arm64-v8a"
        echo "detail=Installed. Reboot for the boot scripts to use it."
        ;;
esac
