import { icons } from './icons.js';
import { toast, nextPaint } from './ksu-bridge.js';
import { loadEverything } from './props-data.js';
import { initI18n } from './i18n.js';
import { applyFullscreen } from './fullscreen.js';
import { checkBinaryUpdate, applyBinaryUpdate, describeBinaryStatus } from './bin-update.js';
import { applyTheme, applyMonet, NIGHT_MODE_COMMAND, parseNightMode } from './theme.js';
import { initKeyboardHandling } from './keyboard.js';
import { renderHomeShell, refreshHome, renderHome, setHomeNotice } from './pages/home.js';
import { renderPropsShell, refreshProps, renderProps } from './pages/props.js';
import { renderSettingsShell, refreshSettings, applySettingsConfig } from './pages/settings.js';
import { renderLogsShell, refreshLogs } from './pages/logs.js';
import { renderAboutShell, refreshAbout, renderAbout, syncMonetSwitch } from './pages/about.js';

const PAGES = {
	home: { render: renderHomeShell, refresh: refreshHome, icon: icons.home, label: 'Home' },
	props: { render: renderPropsShell, refresh: refreshProps, icon: icons.tune, label: 'Props' },
	settings: { render: renderSettingsShell, refresh: refreshSettings, icon: icons.settings, label: 'Settings' },
	logs: { render: renderLogsShell, refresh: refreshLogs, icon: icons.logs, label: 'Logs' },
	about: { render: renderAboutShell, refresh: refreshAbout, icon: icons.info, label: 'About' },
};

const app = document.getElementById('app');
const navBar = document.getElementById('nav-bar');
const refreshBtn = document.getElementById('refresh-btn');

let currentPage = 'home';

// Pages whose data is on screen. Startup fills all but Logs from one
// batched read, and Logs is read on its first visit; after that a tab
// switch only swaps the visible section and never touches the shell
// (every exec() freezes the page - see ksu-bridge.js). The top-bar button
// re-reads the page you're on.
const loaded = new Set();
const loading = new Map();

const pageEl = (key) => document.getElementById(`page-${key}`);

function buildShell() {
	for (const [key, page] of Object.entries(PAGES)) {
		const section = document.createElement('section');
		section.className = 'page';
		section.id = `page-${key}`;
		app.appendChild(section);
		page.render(section);
	}
	navBar.innerHTML = Object.entries(PAGES).map(([key, page]) => `
		<button class="nav-item" data-page="${key}">
			${page.icon}
			<span class="pill">${page.label}</span>
		</button>
	`).join('');
	navBar.addEventListener('click', (e) => {
		const btn = e.target.closest('.nav-item');
		if (btn) goToPage(btn.dataset.page);
	});
	refreshBtn.addEventListener('click', () => refreshCurrentPage());
	// A new language means the other pages' rendered text is stale.
	document.addEventListener('nyx:language-changed', () => {
		for (const key of Object.keys(PAGES)) if (key !== 'settings') loaded.delete(key);
	});
	// Home counts and lists the enabled presets, so a preset toggled,
	// saved, created or deleted on the Props page makes it stale.
	document.addEventListener('nyx:presets-changed', () => loaded.delete('home'));
}

function goToPage(key) {
	if (!PAGES[key]) return;
	currentPage = key;
	document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${key}`));
	document.querySelectorAll('.nav-item').forEach((el) => {
		const active = el.dataset.page === key;
		el.toggleAttribute('aria-current', active);
		if (active) el.setAttribute('aria-current', 'page');
	});
	if (!loaded.has(key)) loadPage(key);
}

/**
 * Read and render one page, after the switch to it is on screen. A page
 * already loading is joined rather than read twice. Without `force`, a
 * page the user has already left by the time a frame is up is skipped -
 * it stays unloaded and is read on its next visit instead.
 */
function loadPage(key, { force = false } = {}) {
	if (loading.has(key)) return loading.get(key);
	const run = (async () => {
		await nextPaint();
		if (!force && currentPage !== key) return;
		await PAGES[key].refresh(pageEl(key));
		loaded.add(key);
	})().finally(() => loading.delete(key));
	loading.set(key, run);
	return run;
}

async function refreshCurrentPage() {
	if (refreshBtn.classList.contains('is-busy')) return;
	refreshBtn.classList.add('is-busy');
	try {
		await loadPage(currentPage, { force: true });
	} finally {
		refreshBtn.classList.remove('is-busy');
	}
}

/**
 * Compare the installed resetprop-rs against the published one and raise
 * a notice if there is something to decide.
 *
 * Never awaited by init(): it does up to three network round trips with
 * 5-10s timeouts, and the UI must not sit blank behind that. Stays silent
 * unless actionable - see describeBinaryStatus.
 */
async function runBinaryUpdateCheck() {
	const result = await checkBinaryUpdate();
	const notice = describeBinaryStatus(result, { silentWhenIdle: true });
	if (!notice) return;
	setHomeNotice({
		...notice,
		onAction: async (btn) => {
			btn.disabled = true;
			btn.textContent = 'Installing…';
			const applied = await applyBinaryUpdate();
			toast(applied.detail || 'Done');
			setHomeNotice(applied.status === 'installed'
				? { kind: 'info', title: 'resetprop-rs updated', subtitle: 'Reboot for the boot scripts to use it.' }
				: { kind: 'warn', title: 'Update failed', subtitle: applied.detail });
		},
	});
}

async function init() {
	// The language files are requested first so they load in the background
	// while the shell read below holds the page. Safe: any failure falls
	// back to the bundled English, so the UI never blocks or blanks.
	const i18nReady = initI18n();
	// Everything the four pages show, plus Android's night mode for the
	// "system" theme, in ONE exec - one root shell - instead of one per value.
	const data = await loadEverything({ night: NIGHT_MODE_COMMAND });
	const { config } = data;
	await i18nReady;
	await applyTheme(config.webui_theme ?? 'system', { systemNight: parseNightMode(data.extra.night) });
	// Same default as config.sh, so a config missing the key behaves like a
	// fresh install. Checked once rather than polled: a manager that serves
	// a palette has it in place by now. Should one still turn up late, it's
	// picked up in the background instead of holding the first render.
	const monetWanted = (config.webui_monet ?? '0') === '1';
	const monet = await applyMonet(monetWanted, { wait: false });
	if (monetWanted && !monet.available) {
		applyMonet(true).then(() => syncMonetSwitch(pageEl('about')));
	}
	applyFullscreen((config.webui_fullscreen ?? '1') === '1');
	initKeyboardHandling();
	buildShell();
	renderHome(pageEl('home'), data.home);
	renderProps(pageEl('props'), data.props);
	applySettingsConfig(pageEl('settings'), config);
	renderAbout(pageEl('about'), data.about);
	for (const key of ['home', 'props', 'settings', 'about']) loaded.add(key);
	goToPage('home');

	// Opt-in: the key defaults to 1 (skip) in config.sh.
	if ((config.disable_webui_bin_update ?? '1') !== '1') {
		runBinaryUpdateCheck();
	}
}

init();
