import { execAsync } from './core/ksu-bridge';
import { MOD_DIR } from './props-data';

const SCRIPT = `${MOD_DIR}/bin-update.sh`;

export interface BinStatus {
	status: string;
	asset: string;
	local: string;
	remote: string;
	latest: string;
	detail: string;
}

const KEYS: readonly (keyof BinStatus)[] = ['status', 'asset', 'local', 'remote', 'latest', 'detail'];

function emptyResult(detail: string): BinStatus {
	return { status: 'error', asset: '', local: '', remote: '', latest: '', detail };
}

function parseBlock(stdout: string): BinStatus {
	const out = emptyResult('');
	for (const line of String(stdout).split('\n')) {
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		if ((KEYS as readonly string[]).includes(key)) out[key as keyof BinStatus] = line.slice(idx + 1).trim();
	}
	return out;
}

async function runStage(stage: 'check' | 'apply'): Promise<BinStatus> {
	const { errno, stdout } = await execAsync(`sh '${SCRIPT}' ${stage} 2>/dev/null`);
	if (errno !== 0 && !String(stdout).trim()) {
		return emptyResult('Could not run bin-update.sh');
	}
	return parseBlock(stdout);
}

let inFlight: Promise<BinStatus> | null = null;

export function checkBinaryUpdate(): Promise<BinStatus> {
	if (!inFlight) {
		const clear = (r: BinStatus): BinStatus => {
			inFlight = null;
			return r;
		};
		inFlight = runStage('check').then(clear, (err) => clear(emptyResult(String(err))));
	}
	return inFlight;
}

export function applyBinaryUpdate(): Promise<BinStatus> {
	return runStage('apply');
}

export interface BinNotice {
	kind: 'info' | 'warn';
	title: string;
	subtitle?: string;
	actionLabel?: string;
}

export function describeBinaryStatus(result: BinStatus, { silentWhenIdle = false }: { silentWhenIdle?: boolean } = {}): BinNotice | null {
	const latest = result.latest ? `Latest release: ${result.latest}.` : '';
	switch (result.status) {
		case 'differs':
			return {
				kind: 'info',
				title: 'A different resetprop-rs build is published',
				subtitle: [latest, 'The installed binary is not byte-identical to it.'].filter(Boolean).join(' '),
				actionLabel: 'Install',
			};
		case 'missing':
			return {
				kind: 'warn',
				title: 'resetprop-rs is not installed',
				subtitle: [latest, 'Auto and resetprop-rs fall back to the stock resetprop until it is.'].filter(Boolean).join(' '),
				actionLabel: 'Install',
			};
		case 'uptodate':
			return silentWhenIdle
				? null
				: {
						kind: 'info',
						title: 'resetprop-rs is up to date',
						subtitle: result.latest ? `Matches the latest release (${result.latest}).` : result.detail,
					};
		case 'offline':
			return silentWhenIdle ? null : { kind: 'warn', title: 'No connection', subtitle: result.detail };
		default:
			return silentWhenIdle ? null : { kind: 'warn', title: 'Update check failed', subtitle: result.detail };
	}
}
