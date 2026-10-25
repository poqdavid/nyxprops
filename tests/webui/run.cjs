// WebUI tests: the built module/webroot in Chromium (Playwright) with a mock
// KernelSU manager.
//
//   node tests/webui/run.cjs [--update]
//
// The mock host behaves like the managers' WebView bridge:
//   exec   -> blocks the page (synchronous XHR) and calls back in a later task
//   spawn  -> runs asynchronously and emits stdout lines, 'exit', then 'error'
//             on a non-zero exit, each in its own task
// and runs every command for real with `sh -c` (NYX_SH=mksh for mksh). Paths
// the WebUI reads on a device (/data/adb, /proc/sys/kernel/random/boot_id)
// are moved into a temporary root seeded from module/ and tests/webui/fixtures,
// so nothing outside it is read or written and results don't depend on the
// machine. getprop answers from the root's data/adb/nyxtest/props.
//
// Checks:
//   functional  everything each page shows and writes, compared with
//               tests/webui/expected/functional.json (--update rewrites it)
//   behaviour   batching, queued saves, spawn fallbacks, caching, logs,
//               late palette, preset changes reaching Home (E1-E11)
//   insets      system-bar padding on KernelSU-style and KernelSU-Next-style
//               managers, with fullscreen on and off
//
// Needs `npm ci && npm run build` first. NYX_CHROMIUM=/path/to/chrome uses an
// existing Chromium instead of Playwright's own; NYX_DEBUG=1 logs every command.
'use strict';
const { chromium } = require('playwright');
const { execFile } = require('child_process');
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const MODULE = path.join(REPO, 'module');
const WEBROOT = path.join(MODULE, 'webroot');
const FIXTURES = path.join(__dirname, 'fixtures');
const EXPECTED = path.join(__dirname, 'expected', 'functional.json');
const UPDATE = process.argv.includes('--update');
const SHELL = process.env.NYX_SH || 'sh';
const SHELL_COST = 80; // ms a manager spends opening a root shell
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(path.join(WEBROOT, 'js', 'app.js'))) {
	console.error('tests/webui: module/webroot/js/app.js not found - run `npm run build` first');
	process.exit(2);
}

// ---------------------------------------------------------------------------
// The device: a temporary root and the path mapping into it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nyxprops-webui-'));
const DEVICE_PATHS = ['/data/adb/', '/proc/sys/kernel/random/boot_id'];
const host = (p) => path.join(ROOT, p);
const PDIR = host('/data/adb/nyxprops');
const PROPS = `${PDIR}/props`;
const MODDIR = host('/data/adb/modules/nyxprops');
const LOGDIR = host('/data/adb/ksu/nyxprops/logs');
const LOG = `${LOGDIR}/props.log`;
const BOOT_ID = host('/proc/sys/kernel/random/boot_id');
const toHost = (cmd) => DEVICE_PATHS.reduce((c, p) => c.split(p).join(ROOT + p), cmd);
const toDevice = (out) => out.split(ROOT).join('');

// The device as the installer and a boot leave it: module files, config.sh
// with its generated vbmeta_size, the shipped presets (plus a few a user
// might write) with their .defaults copies, and this boot's props.log.
function resetDevice() {
	fs.rmSync(ROOT, { recursive: true, force: true });
	fs.cpSync(MODULE, MODDIR, { recursive: true, filter: (src) => !/\.sha256$/.test(src) && !src.startsWith(path.join(MODULE, 'props')) });
	fs.copyFileSync(path.join(FIXTURES, 'bin-update.sh'), path.join(MODDIR, 'bin-update.sh'));
	fs.mkdirSync(`${PROPS}/.defaults`, { recursive: true });
	fs.writeFileSync(`${PDIR}/config.sh`, `${fs.readFileSync(path.join(MODULE, 'config.sh'), 'utf8')}vbmeta_size=13696\n`);
	for (const f of fs.readdirSync(path.join(MODULE, 'props'))) {
		fs.copyFileSync(path.join(MODULE, 'props', f), `${PROPS}/${f}`);
		fs.copyFileSync(path.join(MODULE, 'props', f), `${PROPS}/.defaults/${f}`);
	}
	for (const f of fs.readdirSync(path.join(FIXTURES, 'props'))) fs.copyFileSync(path.join(FIXTURES, 'props', f), `${PROPS}/${f}`);
	fs.mkdirSync(LOGDIR, { recursive: true });
	fs.copyFileSync(path.join(FIXTURES, 'logs', 'props.log'), LOG);
	fs.cpSync(path.join(FIXTURES, 'bin'), host('/data/adb/ksu/bin'), { recursive: true });
	fs.cpSync(path.join(FIXTURES, 'proc'), host('/proc'), { recursive: true });
	fs.mkdirSync(host('/data/adb/nyxtest/props'), { recursive: true });
	for (const line of fs.readFileSync(path.join(FIXTURES, 'device.props'), 'utf8').split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) setDeviceProp(line.slice(0, i), line.slice(i + 1));
	}
	setBinMode('uptodate');
}
const setBinMode = (m) => fs.writeFileSync(host('/data/adb/nyxtest/bin_mode'), m);
const setDeviceProp = (k, v) => fs.writeFileSync(host(`/data/adb/nyxtest/props/${k}`), v);
const readConfig = () => fs.readFileSync(`${PDIR}/config.sh`, 'utf8');
function setConfigKey(k, v) {
	fs.writeFileSync(`${PDIR}/config.sh`, readConfig().replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`));
}
const cfgVal = (k) => (readConfig().match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1];
const preset = (f) => (fs.existsSync(`${PROPS}/${f}`) ? fs.readFileSync(`${PROPS}/${f}`, 'utf8') : null);
const headerBlock = (f) => (preset(f) ?? '').split('\n').filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('#'))).join('\n');

// libsu-style result: output lines joined with \n (one trailing newline dropped).
function runSh(cmd) {
	return new Promise((resolve) => {
		execFile(SHELL, ['-c', `${toHost(cmd)}\nprintf '\\n__END__%s' $?`], {
			env: { ...process.env, PATH: `${host('/data/adb/ksu/bin')}:${process.env.PATH}`, NYX_TEST_ROOT: ROOT },
			maxBuffer: 1 << 26,
		}, (_e, stdout, stderr) => {
			if (process.env.NYX_DEBUG) console.error('[sh]', JSON.stringify(cmd).slice(0, 160), '->', JSON.stringify(stdout).slice(-80), JSON.stringify(stderr).slice(0, 200));
			const i = stdout.lastIndexOf('\n__END__');
			const strip = (s) => toDevice(s.endsWith('\n') ? s.slice(0, -1) : s);
			if (i < 0) return resolve({ errno: 1, stdout: '', stderr: strip(stderr) });
			resolve({ errno: Number(stdout.slice(i + 8)), stdout: strip(stdout.slice(0, i)), stderr: strip(stderr) });
		});
	});
}

// Module functions for the behaviour checks, bundled from webui/src.
const TEST_BUNDLE = esbuild.buildSync({
	stdin: { contents: "export * as bridge from './core/ksu-bridge'; export * as data from './props-data';", resolveDir: path.join(REPO, 'webui', 'src'), loader: 'ts' },
	bundle: true, format: 'esm', target: 'es2020', write: false, logLevel: 'silent',
}).outputFiles[0].text;

// ---------------------------------------------------------------------------
// The mock manager.
let inflight = 0;
let lastNet = Date.now();

function hostInit() {
	const n = (window.__nyx = { execs: 0, spawns: 0, toasts: [], last: performance.now(), pending: 0 });
	const syncPost = (p, body) => {
		const x = new XMLHttpRequest();
		x.open('POST', p, false);
		x.send(JSON.stringify(body));
		return JSON.parse(x.responseText);
	};
	const post = (fn) => { n.pending++; setTimeout(() => { n.pending--; n.last = performance.now(); fn(); }, 0); };
	window.ksu = {
		exec(cmd, opts, cb) {
			if (arguments.length !== 3) throw new Error(`Method not found: exec/${arguments.length}`);
			const r = syncPost('/__nyx_exec', { cmd });
			n.execs++; n.last = performance.now();
			post(() => { try { window[cb](r.errno, r.stdout, r.stderr); } catch (e) { console.error(e); } });
		},
		spawn(command, args, options, cb) {
			if (arguments.length !== 4) throw new Error(`Method not found: spawn/${arguments.length}`);
			syncPost('/__nyx_shell', {});
			n.spawns++; n.last = performance.now(); n.pending++;
			fetch('/__nyx_run', { method: 'POST', body: JSON.stringify({ cmd: command }) }).then((x) => x.json()).then((r) => {
				n.pending--;
				const q = [];
				for (const l of r.lines) q.push(() => { try { window[cb].stdout.emit('data', l); } catch (e) { console.error('emitData', e); } });
				for (const l of r.errLines) q.push(() => { try { window[cb].stderr.emit('data', l); } catch (e) { console.error('emitData', e); } });
				q.push(() => { try { window[cb].emit('exit', r.errno); } catch (e) { console.error(`emitExit error: ${e}`); } });
				if (r.errno !== 0) q.push(() => { try { const err = new Error(); err.exitCode = r.errno; err.message = r.stderr; window[cb].emit('error', err); } catch (e) { console.error('emitErr', e); } });
				for (const f of q) post(f);
			});
		},
		toast(m) { n.toasts.push(String(m)); },
		fullScreen(e) { if (arguments.length !== 1) throw new Error('arity'); },
		enableEdgeToEdge(e) { if (arguments.length !== 1) throw new Error('arity'); },
	};
}

async function serve(route, extra = {}) {
	const req = route.request();
	const p = new URL(req.url()).pathname;
	inflight++;
	try {
		if (extra[p]) return await extra[p](route);
		if (p === '/__nyx_exec') {
			const { cmd } = JSON.parse(req.postData());
			await sleep(SHELL_COST);
			return await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await runSh(cmd)) });
		}
		if (p === '/__nyx_shell') {
			await sleep(SHELL_COST);
			return await route.fulfill({ contentType: 'application/json', body: '{}' });
		}
		if (p === '/__nyx_run') {
			const { cmd } = JSON.parse(req.postData());
			const r = await runSh(cmd);
			const lines = (s) => (s === '' ? [] : s.split('\n'));
			return await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errno: r.errno, lines: lines(r.stdout), errLines: lines(r.stderr), stderr: r.stderr }) });
		}
		if (p === '/__nyxtest.js') return await route.fulfill({ contentType: 'text/javascript', body: TEST_BUNDLE });
		if (p === '/internal/insets.css') {
			return await route.fulfill({ contentType: 'text/css', body: ':root{--safe-area-inset-top:0px;--safe-area-inset-bottom:0px;--window-inset-top:var(--safe-area-inset-top,0px);--window-inset-bottom:var(--safe-area-inset-bottom,0px);}' });
		}
		if (p === '/internal/colors.css') {
			return await route.fulfill({ contentType: 'text/css', body: ':root{--primary:#00696e;--onPrimary:#ffffff;--primaryContainer:#6ff6fe;--onPrimaryContainer:#002022;}' });
		}
		if (p.startsWith('/internal/')) return await route.fulfill({ contentType: 'text/css', body: '' });
		const f = path.join(WEBROOT, p === '/' ? 'index.html' : p);
		if (!f.startsWith(WEBROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return await route.fulfill({ status: 404, body: '' });
		const ct = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' }[path.extname(f)] || 'application/octet-stream';
		return await route.fulfill({ contentType: ct, body: fs.readFileSync(f) });
	} finally {
		inflight--;
		lastNet = Date.now();
	}
}

async function newPage(browser, variant = '') {
	const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
	await page.addInitScript(hostInit);
	if (variant === 'nospawn') await page.addInitScript(() => { delete window.ksu.spawn; });
	if (variant === 'nobridge') await page.addInitScript(() => { delete window.ksu; });
	await page.route('https://mui.kernelsu.org/**', (route) => serve(route));
	return { ctx, page, errors };
}

async function settle(page, quiet = 400) {
	const start = Date.now();
	for (;;) {
		const s = await page.evaluate(() => ({ pending: window.__nyx.pending, idle: performance.now() - window.__nyx.last }));
		if (inflight === 0 && s.pending === 0 && s.idle > quiet && Date.now() - lastNet > quiet && Date.now() - start >= quiet) return;
		if (Date.now() - start > 30000) throw new Error('settle timeout');
		await sleep(50);
	}
}

const counters = (page) => page.evaluate(() => ({ execs: window.__nyx.execs, spawns: window.__nyx.spawns }));

// ---------------------------------------------------------------------------
// Functional snapshot: everything the pages show and write.
async function functional(browser) {
	resetDevice();
	let { page, errors, ctx } = await newPage(browser);
	const snap = {};
	const text = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel);
	const go = async (t) => { await page.click(`.nav-item[data-page="${t}"]`); await settle(page); };
	const dialog = async () => { await page.waitForSelector('.dialog-scrim.open', { timeout: 15000 }); return text('.dialog'); };
	const answer = async (role) => { await page.click(`.dialog [data-role="${role}"]`); await settle(page); };
	const refresh = async () => { await page.click('#refresh-btn'); await settle(page); };
	await page.goto('https://mui.kernelsu.org/index.html');
	await settle(page);
	snap.html = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, themeSource: document.documentElement.dataset.themeSource, fs: document.documentElement.dataset.fullscreen, monet: document.documentElement.dataset.monet ?? null, lang: document.documentElement.lang }));
	snap.nav = await text('#nav-bar');
	for (const t of ['home', 'props', 'settings', 'logs', 'about']) {
		await go(t);
		snap[`page_${t}`] = await text(`#page-${t}`);
	}
	snap.markup = await page.evaluate(() => {
		const norm = (el) => el.outerHTML.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
		return [...document.querySelectorAll('.page, #nav-bar')].map(norm);
	});
	snap.settingsControls = await page.evaluate(() => [...document.querySelectorAll('#page-settings [data-key]')].map((el) => `${el.dataset.key}=${el.type === 'checkbox' ? el.checked : el.value}`));
	snap.aboutControls = await page.evaluate(() => ['theme', 'monet', 'fullscreen'].map((r) => { const el = document.querySelector(`#page-about [data-role="${r}"]`); return `${r}=${el.type === 'checkbox' ? `${el.checked}/${el.disabled}` : el.value}`; }));
	snap.presetSwitches = await page.evaluate(() => [...document.querySelectorAll('#page-props input[data-file]')].map((el) => `${el.dataset.file}=${el.checked}`));

	// Home: the two stat sheets, then the states the status card can show.
	await go('home');
	snap.sheets = {};
	for (const c of ['applied', 'presets']) {
		await page.click(`.stat-card[data-category="${c}"]`);
		await settle(page);
		snap.sheets[c] = { card: await text(`.stat-card[data-category="${c}"]`), sheet: await text('.sheet') };
		await page.click('.sheet [data-role="close"]');
		await settle(page);
	}
	const verifyRows = () => page.evaluate(() => [...document.querySelectorAll('#page-home .check-row')].map((r) => `${r.innerText.replace(/\s+/g, ' ').trim()} [${r.querySelector('.check-row__mark')?.className.replace('check-row__mark', '').trim() ?? 'no mark'}]`));
	snap.home_verify = await verifyRows();
	fs.writeFileSync(BOOT_ID, '11111111-2222-4333-8444-555555555555\n');
	await refresh();
	snap.home_stale = { status: await text('#page-home [data-role="status"]'), applied: await text('.stat-card[data-category="applied"]') };
	await page.click('.stat-card[data-category="applied"]');
	await settle(page);
	snap.home_stale.sheet = await text('.sheet');
	await page.click('.sheet [data-role="close"]');
	fs.copyFileSync(path.join(FIXTURES, 'proc', 'sys', 'kernel', 'random', 'boot_id'), BOOT_ID);
	fs.renameSync(LOG, `${LOG}.away`);
	await refresh();
	snap.home_no_log = await text('#page-home [data-role="status"]');
	fs.writeFileSync(LOG, fs.readFileSync(`${LOG}.away`, 'utf8').replace('[prop_tool]: nyxprops magisk', '[prop_tool]: nyxprops rs'));
	await refresh();
	snap.home_rs = await text('#page-home [data-role="status"]');
	fs.writeFileSync(LOG, fs.readFileSync(`${LOG}.away`, 'utf8').replace('[prop_tool]: nyxprops magisk', '[prop_tool]: nyxprops something-new'));
	await refresh();
	snap.home_unknown_backend = await text('#page-home [data-role="status"]');
	fs.renameSync(`${LOG}.away`, LOG);
	setDeviceProp('ro.boot.verifiedbootstate', 'orange');
	setDeviceProp('ro.boot.flash.locked', '0');
	setDeviceProp('ro.boot.veritymode', 'eio');
	setDeviceProp('ro.build.version.security_patch', '');
	setDeviceProp('ro.product.model', '');
	setDeviceProp('ro.build.version.release', '');
	await refresh();
	snap.home_unverified = { verify: await verifyRows(), device: await text('#page-home [data-role="device"]') };
	resetDevice();
	await refresh();

	// Props: switches (with and without an enabled header), the editor,
	// new and delete.
	await go('props');
	const sw = (f) => `#page-props input[data-file="${f}"]`;
	const det = (f) => `#page-props details[data-file="${f}"]`;
	snap.props_toggle = {};
	for (const f of ['44-mock-location.prop', '65-custom.prop', '66-no-enabled.prop', '67-bare.prop']) {
		await page.click(sw(f));
		await settle(page);
		snap.props_toggle[f] = { checked: await page.isChecked(sw(f)), file: f.startsWith('44') || f.startsWith('65') ? headerBlock(f) : preset(f) };
	}
	await page.click(sw('67-bare.prop'));
	await settle(page);
	snap.props_toggle['67-bare.prop again'] = preset('67-bare.prop');
	await page.click(`${det('20-verified-boot.prop')} summary`);
	await settle(page);
	// The editor gets the file as exec returns it: lines joined with \n, so
	// without the final newline.
	const loaded = await page.inputValue(`${det('20-verified-boot.prop')} [data-role="editor"]`);
	snap.editor_loaded = { same: loaded === preset('20-verified-boot.prop'), sameButFinalNewline: `${loaded}\n` === preset('20-verified-boot.prop') };
	await page.click(sw('20-verified-boot.prop'));
	await settle(page);
	snap.editor_after_toggle = { editor: (await page.inputValue(`${det('20-verified-boot.prop')} [data-role="editor"]`)).split('\n').slice(0, 4).join('\n'), disk: headerBlock('20-verified-boot.prop'), same: (await page.inputValue(`${det('20-verified-boot.prop')} [data-role="editor"]`)) === preset('20-verified-boot.prop') };
	// Save without changing anything: is the file still the shipped default?
	await page.click(`${det('30-warranty.prop')} summary`);
	await settle(page);
	await page.click(`${det('30-warranty.prop')} [data-role="save"]`);
	await settle(page);
	const shipped = fs.readFileSync(`${PROPS}/.defaults/30-warranty.prop`, 'utf8');
	snap.save_unchanged = { sameAsDefault: preset('30-warranty.prop') === shipped, sameButFinalNewline: `${preset('30-warranty.prop')}\n` === shipped };
	await page.click(`${det('66-no-enabled.prop')} summary`);
	await settle(page);
	await page.fill(`${det('66-no-enabled.prop')} [data-role="editor"]`, '# name: Edited in the WebUI\n# max_sdk: 33\n\nreset ro.a 1\nmissing ro.b two words\n# reset ro.c 3\n');
	await page.click(`${det('66-no-enabled.prop')} [data-role="save"]`);
	await settle(page);
	snap.saved_66 = { disk: preset('66-no-enabled.prop'), card: await page.evaluate((s) => document.querySelector(s)?.closest('.card')?.innerText, sw('66-no-enabled.prop')), open: await page.evaluate((s) => document.querySelector(s)?.open, det('66-no-enabled.prop')) };
	await page.click('#page-props [data-role="new"]');
	snap.new_dialog = { text: await dialog(), value: await page.inputValue('.dialog [data-role="input"]') };
	await page.fill('.dialog [data-role="input"]', ' my preset!.prop ');
	await answer('ok');
	snap.new_file = { exists: preset('my-preset.prop') !== null, template: preset('my-preset.prop'), listed: await page.isVisible(sw('my-preset.prop')) };
	for (const name of ['my-preset', '!!!']) {
		await page.click('#page-props [data-role="new"]');
		await dialog();
		await page.fill('.dialog [data-role="input"]', name);
		await answer('ok');
	}
	await page.click('#page-props [data-role="new"]');
	await dialog();
	await answer('cancel');
	await page.click(`${det('my-preset.prop')} summary`);
	await settle(page);
	await page.click(`${det('my-preset.prop')} [data-role="delete"]`);
	snap.delete_dialog = await dialog();
	await answer('cancel');
	snap.after_delete_cancel = preset('my-preset.prop') !== null;
	await page.click(`${det('my-preset.prop')} [data-role="delete"]`);
	await dialog();
	await answer('ok');
	snap.after_delete = { exists: preset('my-preset.prop') !== null, listed: await page.isVisible(sw('my-preset.prop')) };
	await page.click('#page-props [data-role="applied"]');
	await settle(page);
	snap.props_applied_sheet = await text('.sheet');
	await page.click('.sheet [data-role="close"]');
	await settle(page);
	snap.page_props_after = await text('#page-props');
	snap.presets_dir = fs.readdirSync(PROPS).sort();

	// Settings: every control, then the manual binary check.
	await go('settings');
	await page.selectOption('select[data-key="prop_tool"]', 'auto');
	await settle(page);
	snap.after_prop_tool = cfgVal('prop_tool');
	await page.selectOption('select[data-key="hide_compact"]', 'off');
	await settle(page);
	snap.after_hide_compact = cfgVal('hide_compact');
	await page.click('input[data-key="repeat_enabled"]');
	await settle(page);
	snap.after_repeat_enabled = cfgVal('repeat_enabled');
	await page.click('input[data-key="disable_webui_bin_update"]');
	await settle(page);
	snap.after_disable_bin_update = cfgVal('disable_webui_bin_update');
	snap.config_after_settings = readConfig().split('\n').filter((l) => l.trim() && !l.startsWith('#')).join('\n');

	const bin = '[data-action="bin_update_now"]';
	snap.bin = {};
	for (const mode of ['uptodate', 'offline', 'error']) {
		setBinMode(mode);
		await page.click(bin);
		await settle(page);
	}
	setBinMode('differs');
	await page.click(bin);
	snap.bin.differs_auto = await dialog();
	await answer('cancel');
	await page.selectOption('select[data-key="prop_tool"]', 'magisk');
	await settle(page);
	await page.click(bin);
	snap.bin.differs_stock = await dialog();
	await answer('ok');
	snap.bin.button_after_install = await text(bin);
	setBinMode('missing');
	await page.click(bin);
	snap.bin.missing = await dialog();
	await answer('cancel');

	// Logs.
	await go('logs');
	snap.logs = await text('#page-logs');
	snap.logs_note_hidden = await page.evaluate(() => document.querySelector('#page-logs [data-role="note"]').hidden);

	// About.
	await go('about');
	await page.selectOption('#page-about [data-role="theme"]', 'dark');
	await settle(page);
	snap.theme_dark = { cfg: cfgVal('webui_theme'), theme: await page.evaluate(() => document.documentElement.dataset.theme), hint: await text('#page-about [data-role="theme-hint"]') };
	await page.selectOption('#page-about [data-role="theme"]', 'system');
	await settle(page);
	snap.theme_system = { cfg: cfgVal('webui_theme'), theme: await page.evaluate(() => document.documentElement.dataset.theme), hint: await text('#page-about [data-role="theme-hint"]') };
	await page.click('#page-about [data-role="monet"]');
	await settle(page, 1500);
	snap.monet = { cfg: cfgVal('webui_monet'), checked: await page.isChecked('#page-about [data-role="monet"]'), hint: await text('#page-about [data-role="monet-hint"]') };
	await page.click('#page-about [data-role="fullscreen"]');
	await settle(page);
	snap.fullscreen = { cfg: cfgVal('webui_fullscreen'), fs: await page.evaluate(() => document.documentElement.dataset.fullscreen) };

	for (const t of ['home', 'props', 'settings', 'logs', 'about']) {
		await go(t);
		await refresh();
		snap[`refreshed_${t}`] = await text(`#page-${t}`);
	}
	snap.toasts = await page.evaluate(() => window.__nyx.toasts);

	await go('settings');
	await page.selectOption('[data-role="language-select"]', 'en');
	await settle(page);
	snap.settings_after_lang = await text('#page-settings');

	// On-open binary check: notice, Install, installed notice.
	setConfigKey('disable_webui_bin_update', '0');
	setBinMode('differs');
	const firstErrors = errors.slice();
	await ctx.close();
	({ page, errors, ctx } = await newPage(browser));
	await page.goto('https://mui.kernelsu.org/index.html');
	await page.waitForSelector('#page-home .notice-card', { timeout: 15000 });
	snap.notice = await text('#page-home [data-role="notice"]');
	await page.click('#page-home .notice-card__action');
	await page.waitForFunction(() => /updated|failed/i.test(document.querySelector('#page-home [data-role="notice"]')?.innerText || ''), null, { timeout: 15000 });
	await settle(page);
	snap.notice_after = await text('#page-home [data-role="notice"]');
	snap.toasts2 = await page.evaluate(() => window.__nyx.toasts);
	const allErrors = [...firstErrors, ...errors];
	await ctx.close();
	// Up to date or offline on open: nothing shown.
	for (const mode of ['uptodate', 'offline']) {
		setBinMode(mode);
		({ page, errors, ctx } = await newPage(browser));
		await page.goto('https://mui.kernelsu.org/index.html');
		await settle(page, 1800);
		snap[`notice_${mode}`] = await text('#page-home [data-role="notice"]');
		allErrors.push(...errors);
		await ctx.close();
	}
	return { snap: normalize(snap), errors: allErrors };
}

// Whitespace in rendered text varies a little between Chromium releases.
function normalize(v) {
	if (typeof v === 'string') return v.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
	if (Array.isArray(v)) return v.map(normalize);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
	return v;
}

function diffValue(a, b) {
	const x = (typeof a === 'string' ? a : JSON.stringify(a, null, 1) ?? 'undefined').split('\n');
	const y = (typeof b === 'string' ? b : JSON.stringify(b, null, 1) ?? 'undefined').split('\n');
	const out = [];
	for (let i = 0; i < Math.max(x.length, y.length) && out.length < 16; i++) {
		if (x[i] !== y[i]) out.push(`      line ${i + 1}: expected ${JSON.stringify(x[i])}`, `              got      ${JSON.stringify(y[i])}`);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Behaviour checks.
async function behaviour(browser, check) {
	const open = async (variant) => {
		const p = await newPage(browser, variant);
		await p.page.goto('https://mui.kernelsu.org/index.html');
		await settle(p.page);
		return p;
	};

	// E1: execBatch gives each command exactly what a separate exec() would.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const cmds = {
			empty: 'true',
			nonl: "printf 'abc'",
			nl: "printf 'abc\\n'",
			twonl: "printf 'abc\\n\\n'",
			multi: "printf 'a\\nb\\n\\nc\\n'",
			fail: 'echo out; exit 3',
			stderr: 'echo visible; echo hidden >&2',
			tagish: "echo '__NYX_fake_B0'; echo 'E0:9'",
			casey: 'n=yes\ncase "$n" in\n  *yes*) echo dark ;;\n  *) echo light ;;\nesac',
			spaces: "printf '  padded  \\n'",
			unicode: "printf 'ö — ✓\\n'",
			after: 'echo still-here',
		};
		const r = await page.evaluate(async (cmds) => {
			const { bridge } = await import('/__nyxtest.js');
			const batch = await bridge.execBatch(cmds);
			const single = {};
			for (const [k, c] of Object.entries(cmds)) {
				const x = await bridge.exec(`( ${c}\n) 2>/dev/null`);
				single[k] = { errno: x.errno, stdout: x.stdout };
			}
			return { batch, single };
		}, cmds);
		for (const k of Object.keys(cmds)) {
			const b = r.batch[k];
			const s = r.single[k];
			check(`E1 execBatch[${k}]`, b.errno === s.errno && b.stdout === s.stdout, `batch=${JSON.stringify(b)} single=${JSON.stringify(s)}`);
		}
		check('E1 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E2: settings changed in one task all land in config.sh (each save
	// rewrites the whole file, so they must queue).
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		const keys = ['prop_tool', 'hide_compact', 'repeat_enabled', 'disable_webui_bin_update'];
		const before = Object.fromEntries(keys.map((k) => [k, cfgVal(k)]));
		await page.evaluate(() => {
			const sel = (k, v) => { const el = document.querySelector(`select[data-key="${k}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
			sel('prop_tool', 'rs');
			sel('hide_compact', 'global');
			document.querySelector('input[data-key="repeat_enabled"]').click();
			document.querySelector('input[data-key="disable_webui_bin_update"]').click();
		});
		await settle(page);
		const after = Object.fromEntries(keys.map((k) => [k, cfgVal(k)]));
		const want = { prop_tool: "'rs'", hide_compact: "'global'", repeat_enabled: '0', disable_webui_bin_update: '0' };
		check('E2 rapid setting changes all saved', JSON.stringify(after) === JSON.stringify(want), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
		check('E2 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E3: a manager without spawn: the binary check falls back to exec.
	{
		resetDevice();
		const { page, errors, ctx } = await open('nospawn');
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		const a = await counters(page);
		await page.click('[data-action="bin_update_now"]');
		await settle(page);
		const b = await counters(page);
		const toasts = await page.evaluate(() => window.__nyx.toasts);
		check('E3 no-spawn fallback uses exec', b.execs - a.execs === 1 && b.spawns === a.spawns, `exec+${b.execs - a.execs} spawn+${b.spawns - a.spawns}`);
		check('E3 no-spawn result reported', toasts.some((t) => /up to date/.test(t)), JSON.stringify(toasts));
		check('E3 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E4: spawn with a non-zero exit: result shape, and the trailing 'error' event is absorbed.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const r = await page.evaluate(async () => (await import('/__nyxtest.js')).bridge.execAsync("sh -c 'echo one; echo two; echo bad >&2; exit 3'"));
		await settle(page);
		check('E4 execAsync non-zero exit', r.errno === 3 && r.stdout === 'one\ntwo' && r.stderr === 'bad', JSON.stringify(r));
		const r2 = await page.evaluate(async () => (await import('/__nyxtest.js')).bridge.execAsync('true'));
		check('E4 execAsync empty output', r2.errno === 0 && r2.stdout === '' && r2.stderr === '', JSON.stringify(r2));
		await settle(page, 600);
		check('E4 no console errors (error event after exit)', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E5: no bridge at all (desktop preview) still renders.
	{
		resetDevice();
		const { page, errors, ctx } = await open('nobridge');
		const status = await page.evaluate(() => document.querySelector('#page-home .status-card__title')?.textContent);
		const tabs = await page.evaluate(() => document.querySelectorAll('.nav-item').length);
		check('E5 preview mode renders', status === 'Not applied yet' && tabs === 5, `status=${status} tabs=${tabs}`);
		check('E5 no page errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E6: language change -> pages re-read on the next visit; double refresh = one read.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const homeText = await page.evaluate(() => document.querySelector('#page-home').innerText);
		await page.click('.nav-item[data-page="settings"]');
		await settle(page);
		await page.selectOption('[data-role="language-select"]', 'en');
		await settle(page);
		let a = await counters(page);
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		let b = await counters(page);
		check('E6 home re-read after language change', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		check('E6 home unchanged after re-read', homeText === await page.evaluate(() => document.querySelector('#page-home').innerText));
		a = await counters(page);
		await page.click('.nav-item[data-page="settings"]');
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		b = await counters(page);
		check('E6 revisit costs nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		a = await counters(page);
		await page.evaluate(() => { const btn = document.getElementById('refresh-btn'); btn.click(); btn.click(); });
		const spinning = await page.evaluate(() => document.getElementById('refresh-btn').classList.contains('is-busy'));
		await settle(page);
		b = await counters(page);
		const stillSpinning = await page.evaluate(() => document.getElementById('refresh-btn').classList.contains('is-busy'));
		check('E6 double refresh = one read', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		check('E6 refresh icon spins then stops', spinning && !stillSpinning, `during=${spinning} after=${stillSpinning}`);
		check('E6 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E7: each Home sheet equals a fresh read.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const fresh = await page.evaluate(async () => {
			const { data } = await import('/__nyxtest.js');
			return {
				applied: await data.getCategoryEntries('prop'),
				presets: (await data.listPropPresets()).filter((p) => p.enabled).map((p) => `${p.name} (${p.file})`),
			};
		});
		for (const c of ['applied', 'presets']) {
			await page.click(`.stat-card[data-category="${c}"]`);
			await settle(page);
			const shown = await page.evaluate(() => document.querySelector('.sheet [data-role="body"]').innerText);
			const value = await page.evaluate((c) => document.querySelector(`.stat-card[data-category="${c}"] .stat-card__value`).textContent, c);
			const items = fresh[c];
			const allShown = items.every((i) => shown.includes(i));
			check(`E7 sheet ${c} matches fresh read`, allShown && String(items.length) === value && items.length > 0, `card=${value} fresh=${items.length}`);
			await page.click('.sheet [data-role="close"]');
			await settle(page);
		}
		const applied = fresh.applied;
		const logged = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.startsWith('[prop]:')).map((l) => l.replace(/^\S+\s+\S+\s+/, ''));
		check('E7 applied = the [prop] lines of props.log, once each', JSON.stringify(applied) === JSON.stringify([...new Set(logged)].sort()), `${applied.length} vs ${logged.length}`);
		check('E7 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E8: Logs page.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const view = () => page.evaluate(() => {
			const el = document.querySelector('#page-logs [data-role="log"]');
			const note = document.querySelector('#page-logs [data-role="note"]');
			const text = el.classList.contains('is-empty') ? el.textContent : [...el.children].map((c) => c.textContent).join('\n');
			return { text, empty: el.classList.contains('is-empty'), note: note.hidden ? null : note.textContent, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1, scrolls: el.scrollHeight > el.clientHeight };
		});
		const startup = await counters(page);
		check('E8 startup is one read', startup.execs === 1, `exec=${startup.execs}`);
		let a = await counters(page);
		await page.click('.nav-item[data-page="logs"]');
		await settle(page);
		let b = await counters(page);
		check('E8 first visit = one read', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		const v = await view();
		check('E8 log = props.log', v.text === fs.readFileSync(LOG, 'utf8').trim() && !v.empty && v.note === null, JSON.stringify({ empty: v.empty, note: v.note }));
		a = await counters(page);
		await page.click('.nav-item[data-page="home"]');
		await page.click('.nav-item[data-page="logs"]');
		await settle(page);
		b = await counters(page);
		check('E8 revisit costs nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		fs.writeFileSync(LOG, Array.from({ length: 1500 }, (_, i) => `[prop]: nyxprops ro.test.line=${i + 1}`).join('\n') + '\n');
		await page.click('#refresh-btn');
		await settle(page);
		const big = await view();
		const lines = big.text.split('\n');
		check('E8 long log tail', lines.length === 1000 && lines[0].endsWith('=501') && lines[999].endsWith('=1500'), `${lines.length} lines, first=${lines[0]}`);
		check('E8 long log note', big.note === 'Showing the last 1000 of 1500 lines.', String(big.note));
		check('E8 long log scrolled to newest', big.scrolls && big.atBottom, JSON.stringify({ scrolls: big.scrolls, atBottom: big.atBottom }));
		fs.rmSync(LOG, { force: true });
		await page.click('#refresh-btn');
		await settle(page);
		const e = await view();
		check('E8 empty log', e.empty && e.text === 'Nothing logged this boot yet.' && e.note === null, JSON.stringify(e));
		check('E8 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E9: a palette that turns up late is picked up without holding the first render.
	{
		resetDevice();
		setConfigKey('webui_monet', '1');
		const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
		const page = await ctx.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
		page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
		await page.addInitScript(hostInit);
		await page.route('https://mui.kernelsu.org/**', (route) => serve(route, {
			'/internal/colors.css': async (r) => { await sleep(600); await r.fulfill({ contentType: 'text/css', body: ':root{--primary:#00696e;}' }); },
		}));
		await page.goto('https://mui.kernelsu.org/index.html');
		await settle(page, 1800);
		const st = await page.evaluate(() => ({ monet: document.documentElement.dataset.monet ?? null, sw: document.querySelector('#page-about [data-role="monet"]').checked }));
		check('E9 late palette applied', st.monet === 'on' && st.sw === true, JSON.stringify(st));
		check('E9 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E10: a preset changed on Props reaches Home on the next visit, and only then.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		const enabled = () => page.evaluate(() => document.querySelector('.stat-card[data-category="presets"] .stat-card__value').textContent);
		const n0 = await enabled();
		await page.click('.nav-item[data-page="props"]');
		await settle(page);
		let a = await counters(page);
		await page.click('#page-props input[data-file="30-warranty.prop"]');
		await settle(page);
		let b = await counters(page);
		check('E10 a switch is one write', b.execs - a.execs === 1, `exec+${b.execs - a.execs}`);
		a = await counters(page);
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		b = await counters(page);
		const n1 = await enabled();
		check('E10 Home re-read after a preset change', b.execs - a.execs === 1 && Number(n1) === Number(n0) - 1, `exec+${b.execs - a.execs} enabled ${n0} -> ${n1}`);
		await page.click('.stat-card[data-category="presets"]');
		await settle(page);
		const sheet = await page.evaluate(() => document.querySelector('.sheet [data-role="body"]').innerText);
		check('E10 presets sheet no longer lists it', !sheet.includes('30-warranty.prop') && sheet.includes('20-verified-boot.prop'), sheet.slice(0, 120));
		await page.click('.sheet [data-role="close"]');
		a = await counters(page);
		await page.click('.nav-item[data-page="props"]');
		await page.click('.nav-item[data-page="home"]');
		await settle(page);
		b = await counters(page);
		check('E10 then revisits cost nothing', b.execs - a.execs === 0, `exec+${b.execs - a.execs}`);
		check('E10 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}

	// E11: preset switches flipped in one task all land, and names are text, not HTML.
	{
		resetDevice();
		const { page, errors, ctx } = await open();
		await page.click('.nav-item[data-page="props"]');
		await settle(page);
		const files = ['10-vbmeta.prop', '52-security-patch.prop', '65-custom.prop', '67-bare.prop'];
		const before = files.map((f) => /^# enabled: 1$/m.test(headerBlock(f)) || !/^# enabled:/m.test(headerBlock(f)));
		await page.evaluate((files) => files.forEach((f) => document.querySelector(`#page-props input[data-file="${f}"]`).click()), files);
		await settle(page);
		const after = files.map((f) => /^# enabled: 1$/m.test(headerBlock(f)));
		check('E11 rapid preset switches all saved', after.every((x, i) => x === !before[i]), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
		const title = await page.evaluate(() => document.querySelector('#page-props input[data-file="65-custom.prop"]').closest('.card').querySelector('.setting-row__title').innerHTML);
		check('E11 preset name escaped', title === 'Custom &amp; &lt;odd&gt; name', title);
		check('E11 no console errors', errors.length === 0, errors.join(' | '));
		await ctx.close();
	}
}

// ---------------------------------------------------------------------------
// Insets. Two manager models:
//   ksu  - KernelSU / SukiSU-Ultra / ReSukiSU: insets.css turns edge-to-edge
//          on; fullScreen(e) hides/shows the bars and sets edge-to-edge = e;
//          while edge-to-edge is on the manager pushes the system-bar insets
//          into documentElement.style, and the host pads while it's off.
//   ksun - KernelSU-Next: insets.css turns edge-to-edge on and serves the real
//          values; fullScreen only hides/shows the bars.
// Host padding + page padding must equal the visible system bars.
const BARS = { top: 24, bottom: 48 };

function insetsHostInit([model, real, effectDelay]) {
	const h = (window.__host = { model, insetsEnabled: false, barsHidden: false, current: { top: 0, bottom: 0 }, calls: [] });
	const push = (v) => {
		const s = document.documentElement.style;
		s.setProperty('--safe-area-inset-top', `${v.top}px`);
		s.setProperty('--safe-area-inset-right', '0px');
		s.setProperty('--safe-area-inset-bottom', `${v.bottom}px`);
		s.setProperty('--safe-area-inset-left', '0px');
	};
	const effect = () => {
		if (model !== 'ksu' || !h.insetsEnabled) return;
		const v = h.barsHidden ? { top: 0, bottom: 0 } : real;
		if (v.top !== h.current.top || v.bottom !== h.current.bottom) {
			h.current = { ...v };
			push(v);
		}
	};
	const schedule = () => setTimeout(effect, 16);
	h.insetsEnabled = true; // insets.css requested from <head>
	setTimeout(effect, effectDelay);
	h.hostPad = () => (h.insetsEnabled || h.barsHidden ? { top: 0, bottom: 0 } : { ...real });
	const arity = (name, n, args) => {
		if (args.length !== n) throw new Error(`Method not found: ${name}/${args.length}`);
	};
	window.ksu = {
		exec(cmd, opts, cb) {
			window.__nyxExec(cmd).then((r) => window[cb](r.errno, r.stdout, r.stderr));
		},
		toast() {},
		fullScreen(e) {
			arity('fullScreen', 1, arguments);
			h.calls.push(`fullScreen:${e}`);
			setTimeout(() => { h.barsHidden = e; schedule(); }, 0);
			if (model === 'ksu') { h.insetsEnabled = e; schedule(); }
		},
	};
	if (model === 'ksu') {
		window.ksu.enableEdgeToEdge = function (e) {
			arity('enableEdgeToEdge', 1, arguments);
			h.calls.push(`enableEdgeToEdge:${e}`);
			h.insetsEnabled = e;
			schedule();
		};
		window.ksu.enableInsets = window.ksu.enableEdgeToEdge;
	} else {
		window.ksu.enableInsets = function (e) {
			arity('enableInsets', 1, arguments);
			h.calls.push(`enableInsets:${e}`);
			h.insetsEnabled = e;
		};
	}
}

function insetsMeasure() {
	const cs = getComputedStyle;
	const top = parseFloat(cs(document.querySelector('.top-bar')).paddingTop);
	const bottom = parseFloat(cs(document.querySelector('main')).paddingBottom) - 96;
	const hostPad = window.__host.hostPad();
	return { fs: document.documentElement.dataset.fullscreen, barsHidden: window.__host.barsHidden, total: { top: top + hostPad.top, bottom: bottom + hostPad.bottom } };
}

async function insets(browser, check) {
	const insetsCss = (t, b) => `:root{--safe-area-inset-top:${t}px;--safe-area-inset-right:0px;--safe-area-inset-bottom:${b}px;--safe-area-inset-left:0px;--window-inset-top:var(--safe-area-inset-top,0px);--window-inset-bottom:var(--safe-area-inset-bottom,0px);--window-inset-left:var(--safe-area-inset-left,0px);--window-inset-right:var(--safe-area-inset-right,0px);}`;
	for (const model of ['ksu', 'ksun']) {
		for (const effectDelay of [16, 1500]) {
			for (const start of ['0', '1']) {
				resetDevice();
				setConfigKey('webui_fullscreen', start);
				const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
				const page = await ctx.newPage();
				const errors = [];
				page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
				page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
				await page.exposeFunction('__nyxExec', runSh);
				await page.addInitScript(insetsHostInit, [model, BARS, effectDelay]);
				await page.route('https://mui.kernelsu.org/**', (route) => serve(route, {
					'/internal/insets.css': (r) => {
						const v = model === 'ksun' ? BARS : { top: 0, bottom: 0 };
						return r.fulfill({ contentType: 'text/css', body: insetsCss(v.top, v.bottom) });
					},
				}));
				await page.goto('https://mui.kernelsu.org/index.html');
				await page.waitForSelector('.nav-item');
				await page.waitForTimeout(effectDelay + 800);
				const steps = [['load', await page.evaluate(insetsMeasure)]];
				await page.click('.nav-item[data-page="about"]');
				const sw = page.locator('[data-role="fullscreen"]');
				for (let i = 0; i < 2; i++) {
					await sw.evaluate((el) => el.click());
					await page.waitForTimeout(400);
					const m = await page.evaluate(insetsMeasure);
					m.cfg = cfgVal('webui_fullscreen');
					steps.push([`toggle${i + 1}`, m]);
				}
				for (const [name, m] of steps) {
					const want = m.barsHidden ? { top: 0, bottom: 0 } : BARS;
					const ok = m.total.top === want.top && m.total.bottom === want.bottom && m.fs === (m.barsHidden ? 'on' : 'off')
						&& (m.cfg === undefined || m.cfg === (m.fs === 'on' ? '1' : '0'));
					check(`insets ${model} delay=${effectDelay} fullscreen=${start} ${name}`, ok, `fs=${m.fs} padding=${m.total.top}/${m.total.bottom} want=${want.top}/${want.bottom}${m.cfg ? ` cfg=${m.cfg}` : ''}`);
				}
				check(`insets ${model} delay=${effectDelay} fullscreen=${start} no console errors`, errors.length === 0, errors.join(' | '));
				await ctx.close();
			}
		}
	}
}

// ---------------------------------------------------------------------------
async function main() {
	const browser = await chromium.launch(process.env.NYX_CHROMIUM ? { executablePath: process.env.NYX_CHROMIUM } : {});
	const results = [];
	const check = (name, ok, detail = '') => results.push({ name, ok, detail });
	try {
		const { snap, errors } = await functional(browser);
		check('functional: no console errors', errors.length === 0, errors.join(' | '));
		if (UPDATE) {
			fs.mkdirSync(path.dirname(EXPECTED), { recursive: true });
			fs.writeFileSync(EXPECTED, JSON.stringify(snap, null, 1) + '\n');
			console.log(`wrote ${path.relative(REPO, EXPECTED)} (${Object.keys(snap).length} keys)`);
		} else if (!fs.existsSync(EXPECTED)) {
			check('functional: expected file', false, `${path.relative(REPO, EXPECTED)} missing (run with --update)`);
		} else {
			const want = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
			for (const k of [...new Set([...Object.keys(want), ...Object.keys(snap)])]) {
				const same = JSON.stringify(want[k]) === JSON.stringify(snap[k]);
				check(`functional: ${k}`, same, same ? '' : `\n${diffValue(want[k], snap[k]).join('\n')}`);
			}
		}
		await behaviour(browser, check);
		await insets(browser, check);
	} finally {
		await browser.close();
		fs.rmSync(ROOT, { recursive: true, force: true });
	}
	const failed = results.filter((r) => !r.ok);
	for (const r of results) if (!r.ok || process.env.VERBOSE) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : ` - ${r.detail}`}`);
	console.log(`== WebUI (sh=${SHELL}): ${results.length - failed.length}/${results.length} checks passed`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); fs.rmSync(ROOT, { recursive: true, force: true }); process.exit(2); });
