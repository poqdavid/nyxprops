import { getConfig, setConfigValue } from '../props-data.js';
import { toast, nextPaint } from '../ksu-bridge.js';
import { checkBinaryUpdate, applyBinaryUpdate, describeBinaryStatus } from '../bin-update.js';
import { confirmDialog } from '../dialog.js';
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
	{
		title: 'Updates', i18nTitle: 'set_group_updates',
		items: [
			{
				key: 'disable_webui_bin_update', i18n: 'set_disable_bin_update_label', i18nDesc: 'set_disable_bin_update_desc', label: 'Skip resetprop-rs update check on open', type: 'bool',
				desc: 'On by default. Turn it off and opening the WebUI compares the installed resetprop-rs binary against the latest release, then offers to install it — nothing is ever replaced without asking.',
			},
			{
				key: 'bin_update_now', i18n: 'set_bin_update_now_label', i18nDesc: 'set_bin_update_now_desc', i18nAction: 'set_bin_update_now_action', label: 'Check resetprop-rs now', type: 'action', actionLabel: 'Check',
				desc: "Compares hashes against the latest Enginex0/resetprop-rs release for this device's ABI. Works whether or not the check on open is enabled.",
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
		// Pages keep what they rendered across tab switches now, so tell the
		// app to re-read the others in the new language on their next visit.
		document.dispatchEvent(new CustomEvent('nyx:language-changed'));
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
		// Show the flipped switch / picked option first; the write holds the page.
		await nextPaint();
		const { ok } = await setConfigValue(el.dataset.key, value);
		toast(ok ? 'Saved — some settings need a reboot to apply' : 'Failed to save setting');
	});

	groupsEl.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-action="bin_update_now"]');
		if (btn) runManualBinCheck(btn);
	});
}

/** Put the button into its spinning "busy" state with a label. */
function setBtnBusy(btn, label) {
	btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span>${label}`;
}

/**
 * Manual binary check.
 *
 * Unlike the on-open check this reports every outcome, including "up to
 * date" and "no connection": the user pressed a button, so an answer
 * either way is the whole point. checkBinaryUpdate shares one in-flight
 * request, so pressing this while an on-open check is still running joins
 * that one instead of starting a second.
 */
async function runManualBinCheck(btn) {
	const original = btn.innerHTML;
	btn.disabled = true;
	btn.classList.add('is-busy');
	btn.setAttribute('aria-busy', 'true');
	setBtnBusy(btn, 'Checking…');
	// Paint the spinner before the (possibly main-thread-blocking) check runs.
	await nextPaint();
	try {
		const result = await checkBinaryUpdate();
		const notice = describeBinaryStatus(result);
		if (result.status !== 'differs' && result.status !== 'missing') {
			toast(notice ? [notice.title, notice.subtitle].filter(Boolean).join(' — ') : result.detail);
			return;
		}
		// Replacing the binary the boot scripts run is never done without a
		// confirmation. With the stock backend selected it isn't run at all,
		// which is worth saying before the user downloads it. The backend is
		// read off this page's own picker, which shows the saved value, so
		// the dialog doesn't wait on another shell read.
		const toolSelect = btn.closest('.page')?.querySelector('[data-key="prop_tool"]');
		const message = [
			result.detail,
			result.latest ? `Latest release: ${result.latest}` : '',
			(toolSelect?.value || 'magisk') === 'magisk'
				? 'The prop backend is set to the stock resetprop, so this binary is not used until you switch it to Auto or resetprop-rs.'
				: 'A reboot is needed for the boot scripts to use it.',
		].filter(Boolean).join('\n\n');
		if (!(await confirmDialog('Install the published resetprop-rs?', message, 'Install'))) return;

		setBtnBusy(btn, 'Installing…');
		await nextPaint();
		const applied = await applyBinaryUpdate();
		toast(applied.detail || 'Done');
	} finally {
		btn.disabled = false;
		btn.classList.remove('is-busy');
		btn.removeAttribute('aria-busy');
		btn.innerHTML = original;
	}
}

export async function refreshSettings(root) {
	applySettingsConfig(root, await getConfig());
}

/** Set every control from a parsed config.sh (also used at startup). */
export function applySettingsConfig(root, config) {
	root.querySelectorAll('[data-key][data-type]').forEach((el) => {
		const value = config[el.dataset.key];
		if (el.dataset.type === 'bool') {
			el.checked = value === '1';
		} else {
			el.value = value ?? '';
		}
	});
}
