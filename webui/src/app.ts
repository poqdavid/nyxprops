import { icons } from './core/icons';
import { $, closestTarget } from './core/dom';
import { nextPaint, toast } from './core/ksu-bridge';
import { initI18n } from './core/i18n';
import { applyFullscreen } from './core/fullscreen';
import { applyMonet, applyTheme, NIGHT_MODE_COMMAND, parseNightMode } from './core/theme';
import { initKeyboardHandling } from './core/keyboard';
import { loadEverything } from './props-data';
import { applyBinaryUpdate, checkBinaryUpdate, describeBinaryStatus } from './bin-update';
import { refreshHome, renderHome, renderHomeShell, setHomeNotice } from './pages/home';
import { refreshProps, renderProps, renderPropsShell } from './pages/props';
import { applySettingsConfig, refreshSettings, renderSettingsShell } from './pages/settings';
import { refreshLogs, renderLogsShell } from './pages/logs';
import { refreshAbout, renderAbout, renderAboutShell, syncMonetSwitch } from './pages/about';

interface Page {
	render(root: HTMLElement): void;
	refresh(root: HTMLElement): Promise<void>;
	icon: string;
	label: string;
}

const PAGES = {
	home: { render: renderHomeShell, refresh: refreshHome, icon: icons.home, label: 'Home' },
	props: { render: renderPropsShell, refresh: refreshProps, icon: icons.tune, label: 'Props' },
	settings: { render: renderSettingsShell, refresh: refreshSettings, icon: icons.settings, label: 'Settings' },
	logs: { render: renderLogsShell, refresh: refreshLogs, icon: icons.logs, label: 'Logs' },
	about: { render: renderAboutShell, refresh: refreshAbout, icon: icons.info, label: 'About' },
} satisfies Record<string, Page>;

type PageKey = keyof typeof PAGES;
const PAGE_KEYS = Object.keys(PAGES) as PageKey[];

function isPageKey(key: string | undefined): key is PageKey {
	return key !== undefined && Object.prototype.hasOwnProperty.call(PAGES, key);
}

const app = $(document, '#app');
const navBar = $(document, '#nav-bar');
const refreshBtn = $(document, '#refresh-btn');

let currentPage: PageKey = 'home';

const loaded = new Set<PageKey>();
const loading = new Map<PageKey, Promise<void>>();

const pageEl = (key: PageKey): HTMLElement => $(document, `#page-${key}`);

function buildShell(): void {
	for (const key of PAGE_KEYS) {
		const section = document.createElement('section');
		section.className = 'page';
		section.id = `page-${key}`;
		app.appendChild(section);
		PAGES[key].render(section);
	}
	navBar.innerHTML = PAGE_KEYS.map(
		(key) => `
		<button class="nav-item" data-page="${key}">
			${PAGES[key].icon}
			<span class="pill">${PAGES[key].label}</span>
		</button>
	`,
	).join('');
	navBar.addEventListener('click', (e) => {
		const page = closestTarget(e, '.nav-item')?.dataset.page;
		if (isPageKey(page)) goToPage(page);
	});
	refreshBtn.addEventListener('click', () => refreshCurrentPage());
	document.addEventListener('nyx:language-changed', () => {
		for (const key of PAGE_KEYS) if (key !== 'settings') loaded.delete(key);
	});
	document.addEventListener('nyx:presets-changed', () => loaded.delete('home'));
}

function goToPage(key: PageKey): void {
	currentPage = key;
	document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${key}`));
	document.querySelectorAll<HTMLElement>('.nav-item').forEach((el) => {
		const active = el.dataset.page === key;
		el.toggleAttribute('aria-current', active);
		if (active) el.setAttribute('aria-current', 'page');
	});
	if (!loaded.has(key)) loadPage(key);
}

function loadPage(key: PageKey, { force = false }: { force?: boolean } = {}): Promise<void> {
	const pending = loading.get(key);
	if (pending) return pending;
	const run = (async () => {
		await nextPaint();
		if (!force && currentPage !== key) return;
		await PAGES[key].refresh(pageEl(key));
		loaded.add(key);
	})().finally(() => loading.delete(key));
	loading.set(key, run);
	return run;
}

async function refreshCurrentPage(): Promise<void> {
	if (refreshBtn.classList.contains('is-busy')) return;
	refreshBtn.classList.add('is-busy');
	try {
		await loadPage(currentPage, { force: true });
	} finally {
		refreshBtn.classList.remove('is-busy');
	}
}

async function runBinaryUpdateCheck(): Promise<void> {
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
			setHomeNotice(
				applied.status === 'installed'
					? { kind: 'info', title: 'resetprop-rs updated', subtitle: 'Reboot for the boot scripts to use it.' }
					: { kind: 'warn', title: 'Update failed', subtitle: applied.detail },
			);
		},
	});
}

async function init(): Promise<void> {
	const i18nReady = initI18n();
	const data = await loadEverything({ night: NIGHT_MODE_COMMAND });
	const { config } = data;
	await i18nReady;
	await applyTheme(config.webui_theme ?? 'system', { systemNight: parseNightMode(data.extra.night) });
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
	for (const key of ['home', 'props', 'settings', 'about'] as const) loaded.add(key);
	goToPage('home');

	if ((config.disable_webui_bin_update ?? '1') !== '1') {
		runBinaryUpdateCheck();
	}
}

init();
