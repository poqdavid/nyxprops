import { getConfig, setConfigValue } from '../props-data.js';
import { toast } from '../ksu-bridge.js';
import { t, getAvailableLanguages, getCurrentLanguage, setLanguage } from '../i18n.js';

// Every key here is one already shipped in config.sh.
const GROUPS = [
	{
		title: 'Property spoofing', i18nTitle: 'set_group_props',
		items: [
			{
				key: 'prop_tool', i18n: 'set_prop_tool_label', i18nDesc: 'set_prop_tool_desc', i18nOpts: ['set_prop_tool_opt_magisk', 'set_prop_tool_opt_auto', 'set_prop_tool_opt_rs'], label: 'Prop backend', type: 'select',
				options: [['magisk', 'Stock resetprop (default)'], ['auto', 'Auto (resetprop-rs if available)'], ['rs', 'resetprop-rs (stealth)']],
				desc: 'The stock resetprop is the default. resetprop-rs applies changes as stealth writes and count-preserving deletes (--nuke), leaving no serial or gap trace — switch to Auto (uses it when the bundled/downloaded binary works, else stock) or resetprop-rs to opt in. When resetprop-rs is active the rebuild option below is not needed and is skipped.',
			},
			{
				key: 'hide_compact', i18n: 'set_hide_compact_label', i18nDesc: 'set_hide_compact_desc', i18nOpts: ['set_hide_compact_opt_area', 'set_hide_compact_opt_global', 'set_hide_compact_opt_off'], label: 'Rebuild prop areas after changes', type: 'select',
				options: [['area', 'Touched areas only (recommended)'], ['global', 'All areas'], ['off', 'Off']],
				desc: 'Only used with the stock resetprop. Deleting a prop leaves a reclaimable hole in property storage; this compacts it. "Touched areas only" rebuilds just the areas Nyx changed; "All areas" can log harmless errors on devices with an unparseable area (e.g. telephony props). Reclaims the storage gap, not serial counters. Ignored when resetprop-rs is the backend.',
			},
			{
				key: 'repeat_enabled', i18n: 'set_repeat_enabled_label', i18nDesc: 'set_repeat_enabled_desc', label: 'Prop-preset repeat loop', type: 'bool',
				desc: "Master switch for the background loop that periodically re-applies any preset carrying a '# repeat:' header, for the rare prop that resets after boot. Turning it off stops the loop without a reboot. Inactive unless a preset opts in, and the loop is itself a detection signal, so leave it on only when a preset actually needs it.",
			},
		],
	},
];

/**
 * The language selector. Separate from the config-backed GROUPS because the
 * choice lives in localStorage / i18n, not config.sh. Changing it re-applies
 * the language and re-renders the whole Settings page so every t() string
 * updates immediately.
 */
function renderLanguageSelector(cardEl) {
	if (!cardEl) return;
	const langs = getAvailableLanguages();
	const current = getCurrentLanguage();
	const options = Object.entries(langs)
		.map(([code, name]) => `<option value="${code}" ${code === current ? 'selected' : ''}>${name}</option>`)
		.join('');
	cardEl.innerHTML = `
		<div class="setting-row setting-row--stacked">
			<div class="setting-row__text">
				<div class="setting-row__title">${t('set_language_label', 'Interface language')}</div>
				<div class="setting-row__desc">${t('set_language_desc', 'English is the source language. Other languages are community translations and may be incomplete; missing text falls back to English.')}</div>
			</div>
			<select class="select-field select-field--block" data-role="language-select">
				${options}
			</select>
		</div>`;
	const sel = cardEl.querySelector('[data-role="language-select"]');
	sel.addEventListener('change', async (e) => {
		await setLanguage(e.target.value);
		// Re-render the whole settings page in the new language. The shell
		// rebuild re-attaches every handler, so this is self-contained.
		const pageRoot = cardEl.closest('.page') || cardEl.parentElement;
		if (pageRoot) {
			renderSettingsShell(pageRoot);
			refreshSettings(pageRoot);
		}
	});
}

function rowHtml(item, value) {
	// Translate through t() when the item carries i18n keys; the existing
	// literal is always the fallback, so an un-keyed item (or a missing
	// translation) renders exactly as before. This makes the migration
	// additive and impossible to break by omission.
	const label = item.i18n ? t(item.i18n, item.label) : item.label;
	const descText = item.i18nDesc ? t(item.i18nDesc, item.desc) : item.desc;
	const desc = descText ? `<div class="setting-row__desc">${descText}</div>` : '';
	let control = '';
	if (item.type === 'bool') {
		const checked = value === '1' ? 'checked' : '';
		control = `
			<label class="m3-switch">
				<input type="checkbox" data-key="${item.key}" data-type="bool" ${checked}>
				<span class="m3-switch__track"></span>
				<span class="m3-switch__thumb"></span>
			</label>`;
	} else if (item.type === 'select') {
		control = `
			<select class="select-field select-field--block" data-key="${item.key}" data-type="select">
				${item.options.map(([v, l], idx) => {
					const optLabel = item.i18nOpts && item.i18nOpts[idx] ? t(item.i18nOpts[idx], l) : l;
					return `<option value="${v}" ${v === value ? 'selected' : ''}>${optLabel}</option>`;
				}).join('')}
			</select>`;
	} else if (item.type === 'action') {
		// No data-type: refreshSettings must not try to read a config value
		// back into a button.
		const actionLabel = item.i18nAction ? t(item.i18nAction, item.actionLabel ?? 'Run') : (item.actionLabel ?? 'Run');
		control = `<button class="btn btn--tonal" data-action="${item.key}">${actionLabel}</button>`;
	} else {
		control = `<input class="select-field" data-key="${item.key}" data-type="text" value="${value ?? ''}" placeholder="${item.placeholder ?? ''}">`;
	}
	return `
		<div class="setting-row${item.type === 'select' ? ' setting-row--stacked' : ''}">
			<div class="setting-row__text">
				<div class="setting-row__title">${label}</div>
				${desc}
			</div>
			${control}
		</div>`;
}

export function renderSettingsShell(root) {
	root.innerHTML = `
		<h2 class="section-title">${t('set_group_language', 'Language')}</h2>
		<div class="card" data-role="language-card"></div>
		<div data-role="groups"></div>
		<p class="setting-row__desc" style="margin:20px 4px 0;">
			${t('set_footer_props', 'Presets live in the Props section. Most changes take effect on the next reboot.')}
		</p>
	`;

	renderLanguageSelector(root.querySelector('[data-role="language-card"]'));

	const groupsEl = root.querySelector('[data-role="groups"]');
	groupsEl.innerHTML = GROUPS.map((g) => `
		<h2 class="section-title">${g.i18nTitle ? t(g.i18nTitle, g.title) : g.title}</h2>
		<div class="card" data-group="${g.title}">
			${g.items.map((item) => rowHtml(item, '')).join('')}
		</div>
	`).join('');

	groupsEl.addEventListener('change', async (e) => {
		const el = e.target.closest('[data-key]');
		if (!el) return;
		const value = el.dataset.type === 'bool' ? (el.checked ? '1' : '0') : el.value;
		const { ok } = await setConfigValue(el.dataset.key, value);
		toast(ok ? 'Saved — some settings need a reboot to apply' : 'Failed to save setting');
	});
}

export async function refreshSettings(root) {
	const config = await getConfig();
	root.querySelectorAll('[data-key][data-type]').forEach((el) => {
		const value = config[el.dataset.key];
		if (el.dataset.type === 'bool') {
			el.checked = value === '1';
		} else {
			el.value = value ?? '';
		}
	});
}
