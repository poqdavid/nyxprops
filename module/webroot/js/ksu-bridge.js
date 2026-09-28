// Thin wrapper around the native window.ksu bridge that KernelSU / KernelSU
// Next inject into the WebUI's WebView.
//
// The native side only speaks through global callback *names* (it can't
// hand back a JS function across the bridge), so exec() registers a
// one-shot function on `window`, passes its name across, and cleans up
// once it fires. This mirrors the documented behaviour of the official
// `kernelsu` npm package, written fresh here rather than vendored so the
// module has no build step or bundled third-party file.
//
// If window.ksu isn't present at all (e.g. you're previewing index.html in
// a normal desktop browser while designing the UI), everything resolves
// to an empty/failed result instead of throwing, so the page still loads.

let seq = 0;
function uniqueName(prefix) {
	seq += 1;
	return `nyx_${prefix}_${Date.now()}_${seq}`;
}

const hasBridge = () => typeof window.ksu !== 'undefined';

/**
 * Run a root shell command.
 * @param {string} command
 * @param {{cwd?: string, env?: Record<string,string>}} [options]
 * @returns {Promise<{errno:number, stdout:string, stderr:string}>}
 */
export function exec(command, options = {}) {
	return new Promise((resolve) => {
		if (!hasBridge()) {
			console.warn('[nyx] window.ksu not found, running in preview mode:', command);
			resolve({ errno: 1, stdout: '', stderr: 'ksu bridge unavailable (preview mode)' });
			return;
		}
		const cb = uniqueName('exec');
		window[cb] = (errno, stdout, stderr) => {
			delete window[cb];
			resolve({ errno, stdout: stdout ?? '', stderr: stderr ?? '' });
		};
		try {
			window.ksu.exec(command, JSON.stringify(options), cb);
		} catch (err) {
			delete window[cb];
			resolve({ errno: 1, stdout: '', stderr: String(err) });
		}
	});
}

export function toast(message) {
	if (hasBridge() && typeof window.ksu.toast === 'function') {
		window.ksu.toast(message);
	} else {
		console.log('[nyx toast]', message);
	}
}

export function fullScreen(enabled) {
	if (!fullScreenAvailable()) return false;
	try {
		window.ksu.fullScreen(enabled);
		return true;
	} catch (err) {
		console.warn('[nyx] fullScreen failed:', err);
		return false;
	}
}

/** Whether the host actually offers fullScreen. Older managers and the
 * desktop preview don't, and a toggle that silently does nothing is
 * worse than one that says it can't. */
export function fullScreenAvailable() {
	return hasBridge() && typeof window.ksu.fullScreen === 'function';
}

/** Returns module.prop as a parsed object, read directly off disk so it's
 * always current even before a reboot re-renders the manager's cache. */
export async function moduleInfo(modDir) {
	const { errno, stdout } = await exec(`cat '${modDir}/module.prop' 2>/dev/null`);
	const info = {};
	if (errno === 0) {
		for (const line of stdout.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) info[line.slice(0, idx)] = line.slice(idx + 1);
		}
	}
	return info;
}

export const bridgeAvailable = hasBridge;
