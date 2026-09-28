import { exec } from './ksu-bridge.js';

// NyxProps' own directories. Presets and config live under PERSISTENT_DIR;
// the per-boot log (truncated by service.sh every boot) lives under TMP_DIR.
export const MOD_DIR = '/data/adb/modules/nyxprops';
export const PERSISTENT_DIR = '/data/adb/nyxprops';
export const TMP_DIR = '/data/adb/ksu/nyxprops';
export const PROPS_DIR = `${PERSISTENT_DIR}/props`;
export const CONFIG_PATH = `${PERSISTENT_DIR}/config.sh`;
export const LOG_PATH = `${TMP_DIR}/logs/props.log`;

// Tags the boot scripts write into LOG_PATH via nyx_tag_log.
const CATEGORY_SOURCES = {
	prop: {
		userspace: '^\\[prop\\]:',
	},
};

// Strip the leading "[tag]: source " so the entry is just the path. Kept
// as a sub-expression rather than $NF because some Android paths contain
// spaces and would be truncated by whitespace splitting.
const STRIP_TAG = `awk '{ line=$0; sub(/^[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+/, "", line); print line }'`;

async function grepLines(cmd) {
	const { stdout, errno } = await exec(cmd);
	if (errno !== 0) return [];
	return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Flat list of just this module's own tagged actions. */
export async function getCategoryEntries(category) {
	const src = CATEGORY_SOURCES[category];
	if (!src || !src.userspace) return [];
	return grepLines(
		`grep -E '${src.userspace}' '${LOG_PATH}' 2>/dev/null | ${STRIP_TAG} | sort -u`
	);
}

// Reverses the POSIX single-quote escape ' -> '\'' that setConfigValue
// writes for text values, so a value that itself contained an apostrophe
// reads back exactly as typed instead of picking up escape artifacts.
function unescapeShellSingleQuoted(inner) {
	return inner.split("'\\''").join("'");
}

export async function getConfig() {
	const { stdout, errno } = await exec(`cat '${CONFIG_PATH}' 2>/dev/null`);
	const config = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const idx = trimmed.indexOf('=');
			if (idx < 0) continue;
			const key = trimmed.slice(0, idx);
			const raw = trimmed.slice(idx + 1);
			let value = raw;
			const singleQuoted = raw.match(/^'([\s\S]*)'$/);
			const doubleQuoted = raw.match(/^"([\s\S]*)"$/);
			if (singleQuoted) {
				value = unescapeShellSingleQuoted(singleQuoted[1]);
			} else if (doubleQuoted) {
				value = doubleQuoted[1];
			}
			config[key] = value;
		}
	}
	return config;
}

/** Escapes a value for a POSIX single-quoted shell literal, matching how
 * the shipped config.sh quotes its text values. */
function toShellLiteral(value) {
	const str = String(value);
	if (/^-?\d+$/.test(str)) return str;
	return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Writes one key back into config.sh (updating it in place, or appending
 * it if it's not there yet). Boot-stage scripts re-read this file every
 * boot, so most changes need a reboot to take effect - the settings page
 * surfaces that per toggle.
 *
 * The edit is done here in JS and the whole file is written back through
 * the same base64 path setListFile uses, deliberately. Doing it with a
 * shell one-liner instead would mean depending on either exec()'s `env`
 * option (not guaranteed to be honoured by every manager build) or on
 * `awk -v`, which performs backslash-escape processing on the value it is
 * given. Round-tripping base64 depends on neither, and the value is never
 * re-parsed as shell syntax at any point.
 */
export async function setConfigValue(key, value) {
	const { stdout, errno } = await exec(`cat '${CONFIG_PATH}' 2>/dev/null`);
	if (errno !== 0) return { ok: false, error: 'could not read config.sh' };

	const literal = toShellLiteral(value);
	const lines = stdout.split('\n');
	let replaced = false;
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i].startsWith(`${key}=`)) {
			lines[i] = `${key}=${literal}`;
			replaced = true;
			break;
		}
	}
	if (!replaced) {
		// Keep the trailing newline tidy when appending a brand-new key.
		while (lines.length && lines[lines.length - 1] === '') lines.pop();
		lines.push(`${key}=${literal}`, '');
	}

	const b64 = btoa(unescape(encodeURIComponent(lines.join('\n'))));
	const write = await exec(`echo '${b64}' | base64 -d > '${CONFIG_PATH}'`);
	return { ok: write.errno === 0, error: write.stderr };
}

export async function getModuleProp() {
	const { stdout, errno } = await exec(`cat '${MOD_DIR}/module.prop' 2>/dev/null`);
	const prop = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) prop[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}
	return prop;
}

// ---------------------------------------------------------------------
// Prop presets
//
// Each preset is a *.prop file under PROPS_DIR with a small comment
// header (name / description / enabled) followed by "<mode> <prop>
// <value>" rules. service.sh / boot-completed.sh apply them in filename order at boot.
// ---------------------------------------------------------------------

/** Only ever build preset paths from a sanitised filename - the name for
 * a new preset is free text from the user, and it lands in a shell
 * command. Anything outside this set is rejected rather than escaped. */
export function sanitisePresetFilename(name) {
	const base = String(name).trim().replace(/\.prop$/i, '');
	const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
	return cleaned ? `${cleaned}.prop` : '';
}

function isSafePresetFilename(file) {
	return /^[A-Za-z0-9._-]+\.prop$/.test(file) && !file.includes('..');
}

export async function listPropPresets() {
	const cmd = `for f in '${PROPS_DIR}'/*.prop; do
	[ -f "$f" ] || continue
	b=$(basename "$f")
	n=$(sed -n 's/^#[[:space:]]*name:[[:space:]]*//p' "$f" | head -n1)
	d=$(sed -n 's/^#[[:space:]]*description:[[:space:]]*//p' "$f" | head -n1)
	e=$(sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$f" | head -n1)
	s=$(sed -n 's/^#[[:space:]]*stage:[[:space:]]*\\([A-Za-z-]*\\).*/\\1/p' "$f" | head -n1)
	lo=$(sed -n 's/^#[[:space:]]*min_sdk:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$f" | head -n1)
	hi=$(sed -n 's/^#[[:space:]]*max_sdk:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$f" | head -n1)
	c=$(grep -cE '^[[:space:]]*[a-z_]+[[:space:]]+[^[:space:]]+' "$f")
	printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$b" "$n" "$d" "$e" "$c" "$s" "$lo" "$hi"
done`;
	const { stdout, errno } = await exec(cmd);
	if (errno !== 0) return [];
	return stdout
		.split('\n')
		.map((l) => l.split('\t'))
		.filter((p) => p.length >= 5 && p[0])
		.map(([file, name, description, enabled, count, stage, minSdk, maxSdk]) => ({
			file,
			name: name || file.replace(/\.prop$/, ''),
			description: description || '',
			// A preset with no enabled: header counts as enabled, matching
			// what nyx_apply_prop_presets does at boot.
			enabled: enabled === '' ? true : enabled === '1',
			ruleCount: Number(count) || 0,
			// Same default as the runner: no stage header means service.
			stage: stage || 'service',
			minSdk: minSdk || '',
			maxSdk: maxSdk || '',
		}));
}

export async function getPropPreset(file) {
	if (!isSafePresetFilename(file)) return '';
	const { stdout, errno } = await exec(`cat '${PROPS_DIR}/${file}' 2>/dev/null`);
	return errno === 0 ? stdout : '';
}

export async function setPropPreset(file, contents) {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const b64 = btoa(unescape(encodeURIComponent(contents)));
	const { errno, stderr } = await exec(
		`mkdir -p '${PROPS_DIR}' && echo '${b64}' | base64 -d > '${PROPS_DIR}/${file}'`
	);
	return { ok: errno === 0, error: stderr };
}

/** Rewrites just the '# enabled:' header line, leaving the rest of the
 * preset - including the user's own edits and comments - untouched. */
export async function setPropPresetEnabled(file, enabled) {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const val = enabled ? '1' : '0';
	const target = `${PROPS_DIR}/${file}`;
	const cmd = `awk -v en='${val}' '
BEGIN { done = 0 }
done == 0 && /^#[ \\t]*enabled:/ { print "# enabled: " en; done = 1; next }
{ print }
END { if (done == 0) print "# enabled: " en }
' '${target}' > '${target}.nyxtmp' && mv '${target}.nyxtmp' '${target}'`;
	const { errno, stderr } = await exec(cmd);
	return { ok: errno === 0, error: stderr };
}

export async function deletePropPreset(file) {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const { errno, stderr } = await exec(`rm -f '${PROPS_DIR}/${file}'`);
	return { ok: errno === 0, error: stderr };
}

/**
 * Boot-time state for the Home status card. service.sh resets the log every
 * boot and records the kernel boot_id and the backend it used, so comparing
 * boot ids tells "applied this boot" apart from a log left over from an
 * earlier boot (for example, the module was disabled for this one).
 *
 * No top-level `exit` in this command: the manager runs exec() commands in a
 * root shell and waits for an end marker, so exiting early loses the result.
 */
export async function getBootState() {
	const { stdout } = await exec(`if [ -f '${LOG_PATH}' ]; then
	echo "cur=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
	echo "boot=$(grep -E '^\\[boot_id\\]:' '${LOG_PATH}' 2>/dev/null | tail -n1 | ${STRIP_TAG})"
	echo "backend=$(grep -E '^\\[prop_tool\\]:' '${LOG_PATH}' 2>/dev/null | tail -n1 | ${STRIP_TAG})"
else
	echo "nolog=1"
fi`);
	const kv = {};
	for (const line of (stdout || '').split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	const booted = kv.nolog !== '1' && ('cur' in kv || 'boot' in kv);
	// A log without a boot id, or an unreadable current one, can't be dated,
	// so it is taken as current rather than flagged as stale.
	const current = booted && (!kv.boot || !kv.cur || kv.boot === kv.cur);
	return { booted, current, backend: kv.backend || '' };
}

/**
 * Device identity for the Home "Device" section, read live via getprop so it
 * shows the CURRENT (spoofed, if any) values a detector would see.
 */
export async function getDeviceInfo() {
	const [rel, sdk, model, mfr] = await Promise.all([
		exec('getprop ro.build.version.release 2>/dev/null'),
		exec('getprop ro.build.version.sdk 2>/dev/null'),
		exec('getprop ro.product.model 2>/dev/null'),
		exec('getprop ro.product.manufacturer 2>/dev/null'),
	]);
	const t = (r) => (r.stdout || '').trim();
	return {
		model: [t(mfr), t(model)].filter(Boolean).join(' ') || null,
		android: t(rel) ? `${t(rel)}${t(sdk) ? ` (SDK ${t(sdk)})` : ''}` : null,
	};
}

/**
 * Live "is it working" checks for the Home Verification section - the prop
 * rows that used to live on NyxSUSFS's home screen. Each item is
 * { key, value, ok } where ok===true is a pass, false a warning, and null is
 * informational. Read-only getprop, so it reflects what a detector sees now.
 */
export async function getVerification() {
	const [vbs, locked, verity, spl] = await Promise.all([
		exec('getprop ro.boot.verifiedbootstate 2>/dev/null'),
		exec('getprop ro.boot.flash.locked 2>/dev/null'),
		exec('getprop ro.boot.veritymode 2>/dev/null'),
		exec('getprop ro.build.version.security_patch 2>/dev/null'),
	]);
	const t = (r) => (r.stdout || '').trim();
	const l = t(locked);
	const ve = t(verity);
	const v = t(vbs);
	return [
		{ key: 'vbs', ok: v === 'green', value: v || '—' },
		{ key: 'bootloader', ok: l === '1', value: l === '1' ? 'locked' : (l === '' ? '—' : 'unlocked') },
		{ key: 'verity', ok: ve === 'enforcing', value: ve || '—' },
		{ key: 'spl', ok: null, value: t(spl) || '—' },
	];
}
