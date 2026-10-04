#!/system/bin/sh
# NyxProps - resetprop-rs binary update.
#
# Compares the module's resetprop-rs binary for this device's ABI against
# the one attached to the latest Enginex0/resetprop-rs release, and
# installs the published one on request. Run by the WebUI as
# `sh bin-update.sh check|apply`; prints a key=value block and exits 0 so
# the block always reaches the caller.

NYX_MODDIR=${NYX_MODDIR:-/data/adb/modules/nyxprops}
RS_DIR=${RS_DIR:-${NYX_MODDIR}/bin}
NYX_TMPDIR=${NYX_TMPDIR:-/data/adb/ksu/nyxprops}
RS_RELEASE_URL="https://github.com/Enginex0/resetprop-rs/releases/latest/download"
API_URL="https://api.github.com/repos/Enginex0/resetprop-rs/releases/latest"

# Unlike the installer's helper, an HTTP error here is a failure rather
# than a body to hash: -f for curl; busybox wget fails on one already.
download() { busybox wget -T 10 --no-check-certificate -qO - "$1"; }
if command -v curl > /dev/null 2>&1; then
    download() { curl --connect-timeout 10 -fLs "$1"; }
fi

net_check() {
    if command -v curl > /dev/null 2>&1; then
        curl -s --max-time 5 --head "$1" > /dev/null 2>&1
    else
        busybox wget --no-check-certificate --timeout=5 --spider -q "$1" > /dev/null 2>&1
    fi
}

# Release asset for this device. Same mapping as customize.sh and
# nyx_prop_tool_init in utils.sh.
nyx_rs_asset() {
    case "$(getprop ro.product.cpu.abi 2> /dev/null)" in
        arm64* | aarch64*) echo resetprop-arm64-v8a ;;
        armeabi* | armv*) echo resetprop-armeabi-v7a ;;
        x86_64*) echo resetprop-x86_64 ;;
        x86*) echo resetprop-x86 ;;
    esac
}

nyx_rs_is_elf() {
    [ "$(head -c 4 "$1" 2> /dev/null | tail -c 3)" = "ELF" ]
}

# Download the published binary to $1. Fails on a network or HTTP error,
# an empty file, or anything that isn't an ELF, so an error page is never
# hashed or installed.
nyx_rs_fetch() {
    rm -f "$1"
    if download "${RS_RELEASE_URL}/${RS_ASSET}" > "$1" 2> /dev/null && [ -s "$1" ] && nyx_rs_is_elf "$1"; then
        return 0
    fi
    rm -f "$1"
    return 1
}

nyx_rs_sha256() {
    sha256sum "$1" 2> /dev/null | awk '{print $1}'
}

nyx_rs_latest_tag() {
    download "$API_URL" 2> /dev/null \
        | grep -o '"tag_name": *"[^"]*"' \
        | head -n 1 \
        | sed 's/.*"\([^"]*\)"$/\1/'
}

nyx_bin_check() {
    NYX_STATUS=error
    NYX_LOCAL=
    NYX_REMOTE=
    NYX_DETAIL=

    RS_ASSET=$(nyx_rs_asset)
    if [ -z "$RS_ASSET" ]; then
        NYX_DETAIL="No resetprop-rs build for this device's ABI"
        return 1
    fi
    RS_BIN="${RS_DIR}/${RS_ASSET}"

    if ! net_check "${RS_RELEASE_URL}/${RS_ASSET}"; then
        NYX_STATUS=offline
        NYX_DETAIL="No connection to GitHub"
        return 1
    fi

    mkdir -p "$NYX_TMPDIR" 2> /dev/null
    _tmp="${NYX_TMPDIR}/resetprop-rs.check"
    if ! nyx_rs_fetch "$_tmp"; then
        NYX_DETAIL="GitHub is reachable but the published binary could not be fetched"
        return 1
    fi
    NYX_REMOTE=$(nyx_rs_sha256 "$_tmp")
    rm -f "$_tmp"
    if [ -z "$NYX_REMOTE" ]; then
        NYX_DETAIL="Could not hash the published binary"
        return 1
    fi

    if [ ! -f "$RS_BIN" ]; then
        NYX_STATUS=missing
        NYX_DETAIL="No resetprop-rs binary installed at $RS_BIN"
        return 0
    fi

    NYX_LOCAL=$(nyx_rs_sha256 "$RS_BIN")
    if [ -z "$NYX_LOCAL" ]; then
        NYX_DETAIL="Could not hash the installed binary"
        return 1
    fi

    if [ "$NYX_LOCAL" = "$NYX_REMOTE" ]; then
        NYX_STATUS=uptodate
        NYX_DETAIL="Installed binary matches the published one"
    else
        NYX_STATUS=differs
        NYX_DETAIL="Installed binary differs from the published one"
    fi
    return 0
}

nyx_bin_apply() {
    NYX_STATUS=failed
    NYX_LOCAL=
    NYX_REMOTE=
    NYX_DETAIL=

    RS_ASSET=$(nyx_rs_asset)
    if [ -z "$RS_ASSET" ]; then
        NYX_DETAIL="No resetprop-rs build for this device's ABI"
        return 1
    fi
    RS_BIN="${RS_DIR}/${RS_ASSET}"

    mkdir -p "$NYX_TMPDIR" 2> /dev/null
    _tmp="${NYX_TMPDIR}/resetprop-rs.download"

    if ! nyx_rs_fetch "$_tmp"; then
        NYX_DETAIL="Download failed, keeping the current binary"
        return 1
    fi

    chmod 755 "$_tmp"
    if ! "$_tmp" -h > /dev/null 2>&1; then
        rm -f "$_tmp"
        NYX_DETAIL="Downloaded binary did not run, keeping the current one"
        return 1
    fi

    # Swapped in with a rename, so the path always holds a complete
    # binary: a boot script or the repeat loop starting it at this moment
    # gets the old one or the new one, never a missing or half-written
    # file.
    if ! mkdir -p "$RS_DIR" 2> /dev/null \
        || ! cp -f "$_tmp" "${RS_BIN}.new" 2> /dev/null \
        || ! chmod 755 "${RS_BIN}.new" \
        || ! mv -f "${RS_BIN}.new" "$RS_BIN"; then
        rm -f "$_tmp" "${RS_BIN}.new"
        NYX_DETAIL="Could not write $RS_BIN"
        return 1
    fi
    rm -f "$_tmp"

    NYX_LOCAL=$(nyx_rs_sha256 "$RS_BIN")
    NYX_STATUS=installed
    NYX_DETAIL="Installed. Reboot for the boot scripts to use it."
    return 0
}

nyx_bin_emit() {
    echo "status=${NYX_STATUS}"
    echo "asset=${RS_ASSET}"
    echo "local=${NYX_LOCAL}"
    echo "remote=${NYX_REMOTE}"
    echo "latest=${NYX_LATEST}"
    echo "detail=${NYX_DETAIL}"
}

nyx_bin_main() {
    NYX_LATEST=
    RS_ASSET=
    case "$1" in
        check)
            nyx_bin_check
            case "$NYX_STATUS" in
                differs | missing | uptodate) NYX_LATEST=$(nyx_rs_latest_tag) ;;
            esac
            ;;
        apply)
            nyx_bin_apply
            ;;
        *)
            NYX_STATUS=error
            NYX_DETAIL="usage: bin-update.sh check|apply"
            nyx_bin_emit
            return 2
            ;;
    esac

    nyx_bin_emit
    return 0
}

[ "${NYX_BIN_UPDATE_LIB:-0}" = "1" ] || nyx_bin_main "$@"
