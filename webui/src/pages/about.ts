import { $ } from '../core/dom';
import { getAboutData, setConfigValue, PERSISTENT_DIR, MOD_DIR, type AboutData } from '../props-data';
import { applyTheme, applyMonet, monetAvailable } from '../core/theme';
import { applyFullscreen, fullScreenAvailable } from '../core/fullscreen';
import { nextPaint } from '../core/ksu-bridge';
import { t } from '../core/i18n';

export function renderAboutShell(root: HTMLElement): void {
	root.innerHTML = `
		<div class="card" style="text-align:center;">
			<div style="font: var(--md-type-title-lg); margin-bottom:4px;" data-role="name">NyxProps</div>
			<div style="color: var(--md-on-surface-variant);" data-role="version">—</div>
		</div>

		<h2 class="section-title">Appearance</h2>
		<div class="card">
			<div class="setting-row">
				<div class="setting-row__text"><div class="setting-row__title">Theme</div></div>
				<select class="select-field" data-role="theme">
					<option value="system">System</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</div>
			<div class="setting-row__desc" style="padding:0 4px 12px;" data-role="theme-hint"></div>
			<div class="setting-row">
				<div class="setting-row__text">
					<div class="setting-row__title">Material You</div>
					<div class="setting-row__desc" data-role="monet-hint">Use the colours from your wallpaper</div>
				</div>
				<label class="m3-switch">
					<input type="checkbox" data-role="monet">
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
			<div class="setting-row" style="border-bottom:none;">
				<div class="setting-row__text">
					<div class="setting-row__title">Fullscreen</div>
					<div class="setting-row__desc" data-role="fullscreen-hint">Hide the status and navigation bars</div>
				</div>
				<label class="m3-switch">
					<input type="checkbox" data-role="fullscreen">
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
		</div>

		<h2 class="section-title">${t('about_credits_title', 'Credits')}</h2>
		<div class="card">
			<p style="margin:0 0 8px;">${t('about_credits_intro', 'NyxProps is the prop-spoofing companion to NyxSUSFS. The two are separate modules, so each can be installed and updated on its own. It does not need SuSFS.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_magisk', 'The default backend is <strong>resetprop</strong> from <strong>Magisk</strong> by <strong>topjohnwu</strong>, as shipped with KernelSU.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_resetprop_rs', 'NyxProps bundles <strong>resetprop-rs</strong> by <strong>Enginex0</strong> (MIT) as an optional stealth prop backend. Thank you for a great tool.')}</p>
			<p style="margin:0 0 8px;">${t('about_credits_brene', "A number of the prop-spoofing ideas were sparked by studying <strong>BRENE</strong> by <strong>rrr333nnn333</strong>. The ideas were reimplemented in Nyx's own way, but the inspiration deserves a shout-out.")}</p>
			<p style="margin:0 0 8px;">${t('about_credits_poqdavid', 'The WebUI, the preset system and the glue I built myself, with love for the community. Issues and translations welcome.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_credits_config', 'Config &amp; presets:')} <code>${PERSISTENT_DIR}</code></p>
		</div>

		<h2 class="section-title">${t('about_license_title', 'License')}</h2>
		<div class="card">
			<p style="margin:0 0 8px;">${t('about_license_copyright', 'Copyright © 2026 poqdavid')}</p>
			<p style="margin:0 0 8px;">${t('about_license_body', 'NyxProps is free software under the GNU Affero General Public License v3.0 (AGPL-3.0-only). You may redistribute and modify it under that license. It comes with ABSOLUTELY NO WARRANTY.')}</p>
			<p style="margin:0; color: var(--md-on-surface-variant); font-size: 13px;">${t('about_license_where', 'License text and notices:')} <code>${MOD_DIR}/LICENSE</code>, <code>NOTICE.md</code><br>${t('about_license_source', 'Source code:')} <code>github.com/poqdavid/nyxprops</code></p>
		</div>
	`;

	const monet = $<HTMLInputElement>(root, '[data-role="monet"]');
	monet.addEventListener('change', async () => {
		const wanted = monet.checked;
		await nextPaint();
		await setConfigValue('webui_monet', wanted ? '1' : '0');
		const { enabled, available } = await applyMonet(wanted);
		monet.checked = enabled;
		updateMonetHint(root, available);
	});

	const fullscreen = $<HTMLInputElement>(root, '[data-role="fullscreen"]');
	fullscreen.addEventListener('change', async () => {
		const wanted = fullscreen.checked;
		const applied = applyFullscreen(wanted);
		fullscreen.checked = applied;
		await nextPaint();
		await setConfigValue('webui_fullscreen', applied ? '1' : '0');
	});

	const theme = $<HTMLSelectElement>(root, '[data-role="theme"]');
	theme.addEventListener('change', async () => {
		const mode = theme.value;
		await nextPaint();
		await setConfigValue('webui_theme', mode);
		const effective = await applyTheme(mode);
		updateThemeHint(root, mode, effective);
	});
}

export async function refreshAbout(root: HTMLElement): Promise<void> {
	renderAbout(root, await getAboutData());
}

export function renderAbout(root: HTMLElement, { prop, config }: AboutData): void {
	$(root, '[data-role="name"]').textContent = prop.name ?? 'NyxProps';
	$(root, '[data-role="version"]').textContent = [prop.version, prop.author ? `by ${prop.author}` : null].filter(Boolean).join(' · ');

	const mode = config.webui_theme ?? 'system';
	$<HTMLSelectElement>(root, '[data-role="theme"]').value = mode;
	updateThemeHint(root, mode, document.documentElement.dataset.theme);

	syncMonetSwitch(root);

	const fsSwitch = $<HTMLInputElement>(root, '[data-role="fullscreen"]');
	const fsAvailable = fullScreenAvailable();
	fsSwitch.checked = document.documentElement.dataset.fullscreen === 'on';
	fsSwitch.disabled = !fsAvailable;
	$(root, '[data-role="fullscreen-hint"]').textContent = fsAvailable ? 'Hide the status and navigation bars' : "Your manager doesn't support fullscreen";
}

export function syncMonetSwitch(root: HTMLElement): void {
	const monetSwitch = $<HTMLInputElement>(root, '[data-role="monet"]');
	const available = monetAvailable();
	monetSwitch.checked = document.documentElement.dataset.monet === 'on';
	monetSwitch.disabled = !available;
	updateMonetHint(root, available);
}

function updateMonetHint(root: HTMLElement, available: boolean): void {
	const hint = root.querySelector('[data-role="monet-hint"]');
	if (!hint) return;
	hint.textContent = available ? 'Use the colours from your wallpaper' : "Your manager doesn't provide a Material You palette";
}

function updateThemeHint(root: HTMLElement, mode: string, effective: string | undefined): void {
	const hint = root.querySelector('[data-role="theme-hint"]');
	if (!hint) return;
	hint.textContent = mode === 'system' ? `Following the device setting — currently ${effective}.` : '';
}
