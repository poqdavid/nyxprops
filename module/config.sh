#!/bin/sh
# NyxProps persistent config.

# Every key below is read by the boot-stage scripts with a safe default,
# so it's fine to delete a line here — it'll just fall back to the
# in-script default until you set it again from the WebUI.
# vbmeta_size is generated at install time and appended below.

# prop_tool: which backend applies the prop presets.
#   auto    use bundled/downloaded resetprop-rs if a working binary for
#           this ABI is present, otherwise the stock resetprop
#   rs      require resetprop-rs; fall back to stock (with a log warning)
#           if the binary is missing or fails its smoke test
#   magisk  (default) always the stock KernelSU/Magisk resetprop
# resetprop-rs applies sets as stealth writes (ro.* via --init) and
# deletes via --nuke (count-preserving, self-compacting), which leaves no
# trace - so hide_compact below is skipped whenever rs is active. It is
# opt-in: switch to auto or rs to use it.
prop_tool='magisk'

# Prop preset repeat (re-application timer). A preset can carry a
# '# repeat: N' header (N seconds) to have it re-applied periodically -
# for the rare prop that something resets AFTER boot. Off for every
# shipped preset; opt in per preset.
#
# repeat_enabled: master switch. 0 stops ALL preset repeating regardless
#   of headers - one place to kill the background loop. Default 1 (a
#   preset only repeats if it also has a repeat: header, so this being on
#   does nothing until a preset opts in).
# repeat_min_interval: safety floor in seconds. A preset asking for a
#   smaller interval is clamped up to this, so 'repeat: 1' can't spin the
#   CPU. Raise or lower to taste.
#
# NOTE: enabling repeat on any preset starts ONE long-lived background
# process. That process is itself something a detector could notice, so
# it's a deliberate trade - only worth it for a prop you've confirmed
# gets reset. Everything else in the module runs once at boot and exits.
repeat_enabled=1
repeat_min_interval=30

# hide_compact: after prop presets run, how to reclaim the trie holes
# that DELETED props leave behind (a forensic signal a detector can
# read). One of:
#   area    (default) rebuild only the property areas this module
#           actually touched. Safe: never visits unrelated areas.
#   global  one `resetprop -c --force` over every area. Simpler, but on
#           some devices an unrelated area (e.g. radio_prop / gsm.*)
#           cannot be parsed and the rebuild aborts on it - harmless to
#           our props, but noisy. resetprop returns success either way,
#           so this is read from its output, not its exit code.
#   off     do not rebuild. Deletions leave a reclaimable hole.
# Note: this reclaims the arena GAP. It does not rewrite serial counters,
# so it is not, by itself, complete anti-detection for deletions.
hide_compact='area'

# AVB version reported by both ro.boot.avb_version and
# ro.boot.vbmeta.avb_version. The 10-vbmeta preset reads this as the
# {avb_version} token, so the two props can never be set to different
# versions - a mismatch between them is itself a detection signal.
# 'auto' (the default) uses whichever version the device itself
# reports, which is the honest way to make the two agree. Replace it
# with a literal like '1.2' to pin both props to that value instead.
avb_version='auto'

# Nyx-only: WebUI color scheme. One of: system, light, dark.
# Not read by any boot-stage script - safe to ignore outside the WebUI.
webui_theme='system'

# Nyx-only: use the device's Material You palette when the manager
# provides one. 1 = follow Material You, 0 = use Nyx's own palette.
webui_monet=0

# Nyx-only: hide the status and navigation bars while the WebUI is open.
# 1 = fullscreen (the default), 0 = leave the system bars visible, in
# which case the WebUI pads itself for them. Not read by any boot-stage
# script - safe to ignore outside the WebUI.
webui_fullscreen=1
