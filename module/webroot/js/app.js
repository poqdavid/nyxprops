import { icons } from './icons.js';
import { getConfig } from './props-data.js';
import { initI18n } from './i18n.js';
import { applyFullscreen } from './fullscreen.js';
import { applyTheme, applyMonet } from './theme.js';
import { initKeyboardHandling } from './keyboard.js';
import { renderHomeShell, refreshHome } from './pages/home.js';
import { renderPropsShell, refreshProps } from './pages/props.js';
import { renderSettingsShell, refreshSettings } from './pages/settings.js';
import { renderAboutShell, refreshAbout } from './pages/about.js';

const PAGES = {
	home: { render: renderHomeShell, refresh: refreshHome, icon: icons.home, label: 'Home' },
	props: { render: renderPropsShell, refresh: refreshProps, icon: icons.tune, label: 'Props' },
	settings: { render: renderSettingsShell, refresh: refreshSettings, icon: icons.settings, label: 'Settings' },
	about: { render: renderAboutShell, refresh: refreshAbout, icon: icons.info, label: 'About' },
};

const app = document.getElementById('app');
const navBar = document.getElementById('nav-bar');
const refreshBtn = document.getElementById('refresh-btn');

let currentPage = 'home';

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
	refreshCurrentPage();
}

function refreshCurrentPage() {
	const page = PAGES[currentPage];
	const section = document.getElementById(`page-${currentPage}`);
	page.refresh(section);
}

async function init() {
	const config = await getConfig();
	// Load the interface language before anything renders. Safe and fast:
	// it reads a small manifest and the saved choice, and falls back to the
	// bundled English on any failure, so the UI never blocks or blanks.
	await initI18n();
	await applyTheme(config.webui_theme ?? 'system');
	// Same default as config.sh, so a config missing the key behaves like a
	// fresh install.
	await applyMonet((config.webui_monet ?? '0') === '1');
	applyFullscreen((config.webui_fullscreen ?? '1') === '1');
	initKeyboardHandling();
	buildShell();
	goToPage('home');
}

init();
