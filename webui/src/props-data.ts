import { exec, execBatch, type ExecResult } from './core/ksu-bridge';

export const MOD_DIR = '/data/adb/modules/nyxprops';
export const PERSISTENT_DIR = '/data/adb/nyxprops';
export const TMP_DIR = '/data/adb/ksu/nyxprops';
export const PROPS_DIR = `${PERSISTENT_DIR}/props`;
export const CONFIG_PATH = `${PERSISTENT_DIR}/config.sh`;
export const LOG_PATH = `${TMP_DIR}/logs/props.log`;

export type Config = Record<string, string>;

export interface WriteResult {
	ok: boolean;
	error?: string;
}

const NO_RESULT: ExecResult = { errno: 1, stdout: '', stderr: '' };

function withPrefix(prefix: string, commands: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, cmd] of Object.entries(commands)) out[`${prefix}${key}`] = cmd;
	return out;
}

function takePrefix<K extends string>(prefix: string, results: Record<string, ExecResult>): Record<K, ExecResult> {
	const out: Record<string, ExecResult> = {};
	for (const [key, r] of Object.entries(results)) {
		if (key.startsWith(prefix)) out[key.slice(prefix.length)] = r;
	}
	return out as Record<K, ExecResult>;
}

const CATEGORY_SOURCES = {
	prop: { userspace: '^\\[prop\\]:' },
} as const;

const STRIP_TAG = `awk '{ line=$0; sub(/^[^ \\t]+[ \\t]+[^ \\t]+[ \\t]+/, "", line); print line }'`;

function linesOf(r: ExecResult | undefined): string[] {
	if (!r || r.errno !== 0) return [];
	return r.stdout
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
}

function categoryCommand(category: keyof typeof CATEGORY_SOURCES): string | null {
	const src = CATEGORY_SOURCES[category];
	if (!src || !src.userspace) return null;
	return `grep -E '${src.userspace}' '${LOG_PATH}' 2>/dev/null | ${STRIP_TAG} | sort -u`;
}

const APPLIED_COMMAND = categoryCommand('prop') as string;

export async function getCategoryEntries(category: keyof typeof CATEGORY_SOURCES): Promise<string[]> {
	const cmd = categoryCommand(category);
	if (!cmd) return [];
	return linesOf(await exec(cmd));
}

function unescapeShellSingleQuoted(inner: string): string {
	return inner.split("'\\''").join("'");
}

const CONFIG_COMMAND = `cat '${CONFIG_PATH}' 2>/dev/null`;

function parseConfig({ stdout, errno }: ExecResult): Config {
	const config: Config = {};
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
				value = unescapeShellSingleQuoted(singleQuoted[1] ?? '');
			} else if (doubleQuoted) {
				value = doubleQuoted[1] ?? '';
			}
			config[key] = value;
		}
	}
	return config;
}

export async function getConfig(): Promise<Config> {
	return parseConfig(await exec(CONFIG_COMMAND));
}

function toShellLiteral(value: string | number): string {
	const str = String(value);
	if (/^-?\d+$/.test(str)) return str;
	return `'${str.replace(/'/g, "'\\''")}'`;
}

async function writeConfigValue(key: string, value: string | number): Promise<WriteResult> {
	const { stdout, errno } = await exec(CONFIG_COMMAND);
	if (errno !== 0) return { ok: false, error: 'could not read config.sh' };

	const literal = toShellLiteral(value);
	const lines = stdout.split('\n');
	let replaced = false;
	for (let i = 0; i < lines.length; i += 1) {
		if ((lines[i] ?? '').startsWith(`${key}=`)) {
			lines[i] = `${key}=${literal}`;
			replaced = true;
			break;
		}
	}
	if (!replaced) {
		while (lines.length && lines[lines.length - 1] === '') lines.pop();
		lines.push(`${key}=${literal}`, '');
	}

	const b64 = btoa(unescape(encodeURIComponent(lines.join('\n'))));
	const write = await exec(`echo '${b64}' | base64 -d > '${CONFIG_PATH}'`);
	return { ok: write.errno === 0, error: write.stderr };
}

let configWrites: Promise<unknown> = Promise.resolve();

export function setConfigValue(key: string, value: string | number): Promise<WriteResult> {
	const run = configWrites.then(() => writeConfigValue(key, value));
	configWrites = run.catch(() => {});
	return run;
}

const MODULE_PROP_COMMAND = `cat '${MOD_DIR}/module.prop' 2>/dev/null`;

function parseModuleProp({ stdout, errno }: ExecResult): Record<string, string> {
	const prop: Record<string, string> = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) prop[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}
	return prop;
}

export async function getModuleProp(): Promise<Record<string, string>> {
	return parseModuleProp(await exec(MODULE_PROP_COMMAND));
}

export interface Preset {
	file: string;
	name: string;
	description: string;
	enabled: boolean;
	ruleCount: number;
	stage: string;
	minSdk: string;
	maxSdk: string;
}

export function sanitisePresetFilename(name: string): string {
	const base = String(name)
		.trim()
		.replace(/\.prop$/i, '');
	const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
	return cleaned ? `${cleaned}.prop` : '';
}

function isSafePresetFilename(file: string): boolean {
	return /^[A-Za-z0-9._-]+\.prop$/.test(file) && !file.includes('..');
}

const PRESETS_COMMAND = `for f in '${PROPS_DIR}'/*.prop; do
	[ -f "$f" ] || continue
	b=$(basename "$f")
	h=$(awk '!/^#/ { exit } { print }' "$f")
	n=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*name:[[:space:]]*//p' | head -n1)
	d=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*description:[[:space:]]*//p' | head -n1)
	e=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*enabled:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n1)
	s=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*stage:[[:space:]]*\\([A-Za-z-]*\\).*/\\1/p' | head -n1)
	lo=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*min_sdk:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n1)
	hi=$(printf '%s\\n' "$h" | sed -n 's/^#[[:space:]]*max_sdk:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -n1)
	c=$(grep -cE '^[[:space:]]*[a-z_]+[[:space:]]+[^[:space:]]+' "$f")
	printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$b" "$n" "$d" "$e" "$c" "$s" "$lo" "$hi"
done`;

function parsePresets(r: ExecResult | undefined): Preset[] {
	if (!r || r.errno !== 0) return [];
	return r.stdout
		.split('\n')
		.map((l) => l.split('\t'))
		.filter((p) => p.length >= 5 && p[0])
		.map((parts) => {
			const file = parts[0] ?? '';
			const name = parts[1] ?? '';
			const description = parts[2] ?? '';
			const enabled = parts[3] ?? '';
			const count = parts[4] ?? '';
			const stage = parts[5] ?? '';
			const minSdk = parts[6] ?? '';
			const maxSdk = parts[7] ?? '';
			return {
				file,
				name: name || file.replace(/\.prop$/, ''),
				description,
				enabled: enabled === '' ? true : enabled === '1',
				ruleCount: Number(count) || 0,
				stage: stage || 'service',
				minSdk,
				maxSdk,
			};
		});
}

export async function listPropPresets(): Promise<Preset[]> {
	return parsePresets(await exec(PRESETS_COMMAND));
}

export async function getPropPreset(file: string): Promise<string> {
	if (!isSafePresetFilename(file)) return '';
	const { stdout, errno } = await exec(`cat '${PROPS_DIR}/${file}' 2>/dev/null`);
	return errno === 0 ? stdout : '';
}

export async function setPropPreset(file: string, contents: string): Promise<WriteResult> {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const b64 = btoa(unescape(encodeURIComponent(contents)));
	const { errno, stderr } = await exec(`mkdir -p '${PROPS_DIR}' && echo '${b64}' | base64 -d > '${PROPS_DIR}/${file}'`);
	return { ok: errno === 0, error: stderr };
}

export async function setPropPresetEnabled(file: string, enabled: boolean): Promise<WriteResult> {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const val = enabled ? '1' : '0';
	const target = `${PROPS_DIR}/${file}`;
	const cmd = `awk -v en='${val}' '
BEGIN { top = 1; done = 0 }
top && !/^#/ { if (!done) { print "# enabled: " en; done = 1 } top = 0 }
top && !done && /^#[ \\t]*enabled:/ { print "# enabled: " en; done = 1; next }
{ print }
END { if (!done) print "# enabled: " en }
' '${target}' > '${target}.nyxtmp' && mv '${target}.nyxtmp' '${target}'`;
	const { errno, stderr } = await exec(cmd);
	return { ok: errno === 0, error: stderr };
}

export async function deletePropPreset(file: string): Promise<WriteResult> {
	if (!isSafePresetFilename(file)) return { ok: false, error: 'invalid preset filename' };
	const { errno, stderr } = await exec(`rm -f '${PROPS_DIR}/${file}'`);
	return { ok: errno === 0, error: stderr };
}

export interface BootState {
	booted: boolean;
	current: boolean;
	backend: string;
}

const BOOT_COMMAND = `if [ -f '${LOG_PATH}' ]; then
	echo "cur=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
	echo "boot=$(grep -E '^\\[boot_id\\]:' '${LOG_PATH}' 2>/dev/null | tail -n1 | ${STRIP_TAG})"
	echo "backend=$(grep -E '^\\[prop_tool\\]:' '${LOG_PATH}' 2>/dev/null | tail -n1 | ${STRIP_TAG})"
else
	echo "nolog=1"
fi`;

function parseBootState(r: ExecResult | undefined): BootState {
	const kv: Record<string, string> = {};
	for (const line of ((r && r.stdout) || '').split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	const booted = kv.nolog !== '1' && ('cur' in kv || 'boot' in kv);
	const current = booted && (!kv.boot || !kv.cur || kv.boot === kv.cur);
	return { booted, current, backend: kv.backend || '' };
}

export async function getBootState(): Promise<BootState> {
	return parseBootState(await exec(BOOT_COMMAND));
}

export interface DeviceInfo {
	model: string | null;
	android: string | null;
}

const DEVICE_COMMANDS = {
	rel: 'getprop ro.build.version.release 2>/dev/null',
	sdk: 'getprop ro.build.version.sdk 2>/dev/null',
	model: 'getprop ro.product.model 2>/dev/null',
	mfr: 'getprop ro.product.manufacturer 2>/dev/null',
} as const;

const trimmed = (r: ExecResult | undefined): string => ((r && r.stdout) || '').trim();

function parseDeviceInfo(results: Record<keyof typeof DEVICE_COMMANDS, ExecResult>): DeviceInfo {
	const rel = trimmed(results.rel);
	const sdk = trimmed(results.sdk);
	return {
		model: [trimmed(results.mfr), trimmed(results.model)].filter(Boolean).join(' ') || null,
		android: rel ? `${rel}${sdk ? ` (SDK ${sdk})` : ''}` : null,
	};
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
	return parseDeviceInfo(await execBatch(DEVICE_COMMANDS));
}

export interface VerifyItem {
	key: string;
	ok: boolean | null;
	value: string;
}

const VERIFY_COMMANDS = {
	vbs: 'getprop ro.boot.verifiedbootstate 2>/dev/null',
	locked: 'getprop ro.boot.flash.locked 2>/dev/null',
	verity: 'getprop ro.boot.veritymode 2>/dev/null',
	spl: 'getprop ro.build.version.security_patch 2>/dev/null',
} as const;

function parseVerification(results: Record<keyof typeof VERIFY_COMMANDS, ExecResult>): VerifyItem[] {
	const l = trimmed(results.locked);
	const ve = trimmed(results.verity);
	const v = trimmed(results.vbs);
	return [
		{ key: 'vbs', ok: v === 'green', value: v || '—' },
		{ key: 'bootloader', ok: l === '1', value: l === '1' ? 'locked' : l === '' ? '—' : 'unlocked' },
		{ key: 'verity', ok: ve === 'enforcing', value: ve || '—' },
		{ key: 'spl', ok: null, value: trimmed(results.spl) || '—' },
	];
}

export async function getVerification(): Promise<VerifyItem[]> {
	return parseVerification(await execBatch(VERIFY_COMMANDS));
}

export const LOG_LINES = 1000;

export interface LogData {
	text: string;
	total: number;
}

const LOG_COMMANDS = {
	text: `tail -n ${LOG_LINES} '${LOG_PATH}' 2>/dev/null`,
	total: `wc -l < '${LOG_PATH}' 2>/dev/null`,
} as const;

function parseLog({ text, total }: Record<keyof typeof LOG_COMMANDS, ExecResult>): LogData {
	return {
		text: text.errno === 0 ? text.stdout : '',
		total: Number((total.stdout || '').trim()) || 0,
	};
}

export async function getLog(): Promise<LogData> {
	return parseLog(await execBatch(LOG_COMMANDS));
}

export interface HomeData {
	boot: BootState;
	applied: string[];
	presets: Preset[];
	verify: VerifyItem[];
	device: DeviceInfo;
}

function homeCommands(): Record<string, string> {
	return {
		boot: BOOT_COMMAND,
		applied: APPLIED_COMMAND,
		presets: PRESETS_COMMAND,
		...withPrefix('verify.', VERIFY_COMMANDS),
		...withPrefix('device.', DEVICE_COMMANDS),
	};
}

function parseHome(results: Record<string, ExecResult>): HomeData {
	return {
		boot: parseBootState(results.boot),
		applied: linesOf(results.applied),
		presets: parsePresets(results.presets),
		verify: parseVerification(takePrefix<keyof typeof VERIFY_COMMANDS>('verify.', results)),
		device: parseDeviceInfo(takePrefix<keyof typeof DEVICE_COMMANDS>('device.', results)),
	};
}

export async function getHomeData(): Promise<HomeData> {
	return parseHome(await execBatch(homeCommands()));
}

export interface PropsData {
	presets: Preset[];
	applied: string[];
}

export async function getPropsData(): Promise<PropsData> {
	const r = await execBatch({ presets: PRESETS_COMMAND, applied: APPLIED_COMMAND });
	return { presets: parsePresets(r.presets), applied: linesOf(r.applied) };
}

export interface AboutData {
	prop: Record<string, string>;
	config: Config;
}

export async function getAboutData(): Promise<AboutData> {
	const r = await execBatch({ prop: MODULE_PROP_COMMAND, config: CONFIG_COMMAND });
	return { prop: parseModuleProp(r.prop), config: parseConfig(r.config) };
}

export interface Everything<E extends string> {
	config: Config;
	home: HomeData;
	props: PropsData;
	about: AboutData;
	extra: Record<E, ExecResult>;
}

export async function loadEverything<E extends string>(extra: Record<E, string> = {} as Record<E, string>): Promise<Everything<E>> {
	const commands: Record<string, string> = {
		config: CONFIG_COMMAND,
		prop: MODULE_PROP_COMMAND,
	};
	Object.assign(commands, withPrefix('home.', homeCommands()), withPrefix('extra.', extra));
	const r = await execBatch(commands);
	const config = parseConfig(r.config ?? NO_RESULT);
	const home = parseHome(takePrefix('home.', r));
	return {
		config,
		home,
		props: { presets: home.presets, applied: home.applied },
		about: { prop: parseModuleProp(r.prop ?? NO_RESULT), config },
		extra: takePrefix<E>('extra.', r),
	};
}
