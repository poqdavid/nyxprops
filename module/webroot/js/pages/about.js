import { getModuleProp, getConfig, setConfigValue, PERSISTENT_DIR, MOD_DIR } from '../props-data.js';
import { applyTheme, applyMonet, monetAvailable } from '../theme.js';
import { applyFullscreen, fullScreenAvailable } from '../fullscreen.js';
import { t } from '../i18n.js';

export function renderAboutShell(root) {
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
			<p style="margin:0 0 8px;">${t('about_credits_intro', 'NyxProps is the prop-spoofing half of NyxSUSFS, split out so it can be installed, updated and switched off on its own. It does not need SuSFS.')}</p>
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

	root.querySelector('[data-role="monet"]').addEventListener('change', async (e) => {
		const wanted = e.target.checked;
		await setConfigValue('webui_monet', wanted ? '1' : '0');
		const { enabled, available } = await applyMonet(wanted);
		// If the manager never supplied a palette, don't leave the switch
		// sitting on while the colours plainly haven't changed.
		e.target.checked = enabled;
		updateMonetHint(root, available);
	});

	root.querySelector('[data-role="fullscreen"]').addEventListener('change', async (e) => {
		const wanted = e.target.checked;
		// Applied first so the change is visible immediately; the config
		// write only decides what happens next time the WebUI opens.
		const applied = applyFullscreen(wanted);
		e.target.checked = applied;
		await setConfigValue('webui_fullscreen', applied ? '1' : '0');
	});

	root.querySelector('[data-role="theme"]').addEventListener('change', async (e) => {
		const mode = e.target.value;
		await setConfigValue('webui_theme', mode);
		const effective = await applyTheme(mode);
		updateThemeHint(root, mode, effective);
	});
}

export async function refreshAbout(root) {
	const [prop, config] = await Promise.all([getModuleProp(), getConfig()]);

	root.querySelector('[data-role="name"]').textContent = prop.name ?? 'NyxProps';
	root.querySelector('[data-role="version"]').textContent = [prop.version, prop.author ? `by ${prop.author}` : null].filter(Boolean).join(' · ');

	const mode = config.webui_theme ?? 'system';
	root.querySelector('[data-role="theme"]').value = mode;
	// Show what "System" actually resolved to - otherwise there's no way to
	// tell whether it read the device setting correctly.
	updateThemeHint(root, mode, document.documentElement.dataset.theme);

	const monetSwitch = root.querySelector('[data-role="monet"]');
	const available = monetAvailable();
	monetSwitch.checked = document.documentElement.dataset.monet === 'on';
	monetSwitch.disabled = !available;
	updateMonetHint(root, available);

	// Read back off the document rather than the config, so the switch
	// shows what is actually in effect - the two differ when the host has
	// no fullScreen to call.
	const fsSwitch = root.querySelector('[data-role="fullscreen"]');
	const fsAvailable = fullScreenAvailable();
	fsSwitch.checked = document.documentElement.dataset.fullscreen === 'on';
	fsSwitch.disabled = !fsAvailable;
	root.querySelector('[data-role="fullscreen-hint"]').textContent = fsAvailable
		? 'Hide the status and navigation bars'
		: "Your manager doesn't support fullscreen";
}

function updateMonetHint(root, available) {
	const hint = root.querySelector('[data-role="monet-hint"]');
	if (!hint) return;
	hint.textContent = available
		? 'Use the colours from your wallpaper'
		: "Your manager doesn't provide a Material You palette";
}

function updateThemeHint(root, mode, effective) {
	const hint = root.querySelector('[data-role="theme-hint"]');
	if (!hint) return;
	hint.textContent = mode === 'system'
		? `Following the device setting — currently ${effective}.`
		: '';
}
