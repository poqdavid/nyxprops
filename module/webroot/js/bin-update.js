// resetprop-rs binary update, WebUI side.
//
// All the actual logic lives in the module's bin-update.sh - this only
// runs it and parses the key=value block it writes. Invoked as
// `sh bin-update.sh`, deliberately, so it works whether or not the file
// kept its exec bit through install.
//
// The check is OFF by default (disable_webui_bin_update=1). It talks to
// the network, it compares against a third-party release, and the result
// is never acted on without being asked, so opting in is the right way
// round.
//
// Both stages go through execAsync (the manager's spawn), not exec: they
// wait on the network for seconds, and a blocking exec would freeze the
// whole WebUI for that long.

import { execAsync } from './ksu-bridge.js';
import { MOD_DIR } from './props-data.js';

const SCRIPT = `${MOD_DIR}/bin-update.sh`;
const KEYS = ['status', 'asset', 'local', 'remote', 'latest', 'detail'];

function emptyResult(detail) {
	return { status: 'error', asset: '', local: '', remote: '', latest: '', detail };
}

function parseBlock(stdout) {
	const out = emptyResult('');
	for (const line of String(stdout).split('\n')) {
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		if (KEYS.includes(key)) out[key] = line.slice(idx + 1).trim();
	}
	return out;
}

async function runStage(stage) {
	const { errno, stdout } = await execAsync(`sh '${SCRIPT}' ${stage} 2>/dev/null`);
	// check/apply exit 0 on purpose so the block always survives; a
	// non-zero errno with no output means the script could not be run at
	// all (missing file, no shell), which is worth reporting differently
	// from "the network was down".
	if (errno !== 0 && !String(stdout).trim()) {
		return emptyResult('Could not run bin-update.sh');
	}
	return parseBlock(stdout);
}

let inFlight = null;

/**
 * Compare the installed resetprop-rs binary against the published one.
 *
 * One shared in-flight promise: the check does up to three network round
 * trips with 5-10s timeouts, so the Settings "Check" button pressed while
 * the on-open check is still running should join that one rather than
 * start a second.
 *
 * @returns {Promise<{status:string, asset:string, local:string, remote:string, latest:string, detail:string}>}
 */
export function checkBinaryUpdate() {
	if (!inFlight) {
		const clear = (r) => { inFlight = null; return r; };
		inFlight = runStage('check').then(clear, (err) => clear(emptyResult(String(err))));
	}
	return inFlight;
}

/** Download and install the published binary. Always explicit - nothing
 * calls this without the user asking for it. */
export function applyBinaryUpdate() {
	return runStage('apply');
}

/**
 * Turn a result into something worth showing, or null for "say nothing".
 *
 * `silentWhenIdle` is set for the automatic on-open check: being offline
 * or hitting an error is not something the user asked about, so it stays
 * quiet and only speaks up when there is actually a decision to make. A
 * manual check reports every outcome, because the user pressed a button
 * and deserves an answer either way.
 */
export function describeBinaryStatus(result, { silentWhenIdle = false } = {}) {
	const latest = result.latest ? `Latest release: ${result.latest}.` : '';
	switch (result.status) {
		case 'differs':
			return {
				kind: 'info',
				title: 'A different resetprop-rs build is published',
				// Deliberately not "newer": this is a hash comparison, so
				// a binary from an older or custom build reads as
				// differing too.
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
			return silentWhenIdle
				? null
				: { kind: 'warn', title: 'No connection', subtitle: result.detail };
		default:
			return silentWhenIdle
				? null
				: { kind: 'warn', title: 'Update check failed', subtitle: result.detail };
	}
}
