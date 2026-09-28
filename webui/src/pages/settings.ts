import { getConfig, setConfigValue, type Config } from '../props-data';
import { $, closestTarget } from '../core/dom';
import { toast, nextPaint } from '../core/ksu-bridge';
import { checkBinaryUpdate, applyBinaryUpdate, describeBinaryStatus } from '../bin-update';
import { confirmDialog } from '../core/dialog';
import { t, getAvailableLanguages, getCurrentLanguage, setLanguage } from '../core/i18n';

type ItemType = 'bool' | 'select' | 'action' | 'text';

interface Item {
	key: string;
	label: string;
	type: ItemType;
	desc?: string;
	i18n?: string;
	i18nDesc?: string;
	i18nOpts?: string[];
	i18nAction?: string;
	options?: [string, string][];
	actionLabel?: string;
	placeholder?: string;
}

interface Group {
	title: string;
	i18nTitle?: string;
	items: Item[];
}

const GROUPS: Group[] = [
	{
		title: 'Property spoofing',
		i18nTitle: 'set_group_props',
		items: [
			{
				key: 'prop_tool',
				i18n: 'set_prop_tool_label',
				i18nDesc: 'set_prop_tool_desc',
				i18nOpts: ['set_prop_tool_opt_magisk', 'set_prop_tool_opt_auto', 'set_prop_tool_opt_rs'],
				label: 'Prop backend',
				type: 'select',
				options: [
					['magisk', 'Stock resetprop (default)'],
					['auto', 'Auto (resetprop-rs if available)'],
					['rs', 'resetprop-rs (stealth)'],
				],
				desc: 'The stock resetprop is the default. resetprop-rs applies changes as stealth writes and count-preserving deletes (--nuke), leaving no serial or gap trace — switch to Auto (uses it when the bundled/downloaded binary works, else stock) or resetprop-rs to opt in. When resetprop-rs is active the rebuild option below is not needed and is skipped.',
			},
			{
				key: 'hide_compact',
				i18n: 'set_hide_compact_label',
				i18nDesc: 'set_hide_compact_desc',
				i18nOpts: ['set_hide_compact_opt_area', 'set_hide_compact_opt_global', 'set_hide_compact_opt_off'],
				label: 'Rebuild prop areas after changes',
				type: 'select',
				options: [
					['area', 'Touched areas only (recommended)'],
					['global', 'All areas'],
					['off', 'Off'],
				],
				desc: 'Only used with the stock resetprop. Deleting a prop leaves a reclaimable hole in property storage; this compacts it. "Touched areas only" rebuilds just the areas Nyx changed; "All areas" can log harmless errors on devices with an unparseable area (e.g. telephony props). Reclaims the storage gap, not serial counters. Ignored when resetprop-rs is the backend.',
			},
			{
				key: 'repeat_enabled',
				i18n: 'set_repeat_enabled_label',
				i18nDesc: 'set_repeat_enabled_desc',
				label: 'Prop-preset repeat loop',
				type: 'bool',
				desc: "Master switch for the background loop that periodically re-applies any preset carrying a '# repeat:' header, for the rare prop that resets after boot. Turning it off stops the loop without a reboot. Inactive unless a preset opts in, and the loop is itself a detection signal, so leave it on only when a preset actually needs it.",
			},
		],
	},
	{
		title: 'Updates',
		i18nTitle: 'set_group_updates',
		items: [
			{
				key: 'disable_webui_bin_update',
				i18n: 'set_disable_bin_update_label',
				i18nDesc: 'set_disable_bin_update_desc',
				label: 'Skip resetprop-rs update check on open',
				type: 'bool',
				desc: 'On by default. Turn it off and opening the WebUI compares the installed resetprop-rs binary against the latest release, then offers to install it — nothing is ever replaced without asking.',
			},
			{
				key: 'bin_update_now',
				i18n: 'set_bin_update_now_label',
				i18nDesc: 'set_bin_update_now_desc',
				i18nAction: 'set_bin_update_now_action',
				label: 'Check resetprop-rs now',
				type: 'action',
				actionLabel: 'Check',
				desc: "Compares hashes against the latest Enginex0/resetprop-rs release for this device's ABI. Works whether or not the check on open is enabled.",
			},
		],
	},
];

function renderLanguageSelector(cardEl: HTMLElement | null): void {
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
	const sel = $<HTMLSelectElement>(cardEl, '[data-role="language-select"]');
	sel.addEventListener('change', async () => {
		await setLanguage(sel.value);
		const pageRoot = (cardEl.closest('.page') as HTMLElement | null) ?? (cardEl.parentElement as HTMLElement | null);
		if (pageRoot) {
			renderSettingsShell(pageRoot);
			refreshSettings(pageRoot);
		}
		document.dispatchEvent(new CustomEvent('nyx:language-changed'));
	});
}

function rowHtml(item: Item, value: string): string {
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
				${(item.options ?? [])
					.map(([v, l], idx) => {
						const optKey = item.i18nOpts?.[idx];
						const optLabel = optKey ? t(optKey, l) : l;
						return `<option value="${v}" ${v === value ? 'selected' : ''}>${optLabel}</option>`;
					})
					.join('')}
			</select>`;
	} else if (item.type === 'action') {
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

export function renderSettingsShell(root: HTMLElement): void {
	root.innerHTML = `
		<h2 class="section-title">${t('set_group_language', 'Language')}</h2>
		<div class="card" data-role="language-card"></div>
		<div data-role="groups"></div>
		<p class="setting-row__desc" style="margin:20px 4px 0;">
			${t('set_footer_props', 'Presets live in the Props section. Most changes take effect on the next reboot.')}
		</p>
	`;

	renderLanguageSelector(root.querySelector('[data-role="language-card"]'));

	const groupsEl = $(root, '[data-role="groups"]');
	groupsEl.innerHTML = GROUPS.map(
		(g) => `
		<h2 class="section-title">${g.i18nTitle ? t(g.i18nTitle, g.title) : g.title}</h2>
		<div class="card" data-group="${g.title}">
			${g.items.map((item) => rowHtml(item, '')).join('')}
		</div>
	`,
	).join('');

	groupsEl.addEventListener('change', async (e) => {
		const el = closestTarget<HTMLInputElement>(e, '[data-key]');
		if (!el) return;
		const key = el.dataset.key;
		if (!key) return;
		const value = el.dataset.type === 'bool' ? (el.checked ? '1' : '0') : el.value;
		await nextPaint();
		const { ok } = await setConfigValue(key, value);
		toast(ok ? 'Saved — some settings need a reboot to apply' : 'Failed to save setting');
	});

	groupsEl.addEventListener('click', (e) => {
		const btn = closestTarget<HTMLButtonElement>(e, '[data-action="bin_update_now"]');
		if (btn) runManualBinCheck(btn);
	});
}

function setBtnBusy(btn: HTMLButtonElement, label: string): void {
	btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span>${label}`;
}

async function runManualBinCheck(btn: HTMLButtonElement): Promise<void> {
	const original = btn.innerHTML;
	btn.disabled = true;
	btn.classList.add('is-busy');
	btn.setAttribute('aria-busy', 'true');
	setBtnBusy(btn, 'Checking…');
	await nextPaint();
	try {
		const result = await checkBinaryUpdate();
		const notice = describeBinaryStatus(result);
		if (result.status !== 'differs' && result.status !== 'missing') {
			toast(notice ? [notice.title, notice.subtitle].filter(Boolean).join(' — ') : result.detail);
			return;
		}
		const toolSelect = btn.closest('.page')?.querySelector('[data-key="prop_tool"]') as HTMLSelectElement | null;
		const message = [
			result.detail,
			result.latest ? `Latest release: ${result.latest}` : '',
			(toolSelect?.value || 'magisk') === 'magisk'
				? 'The prop backend is set to the stock resetprop, so this binary is not used until you switch it to Auto or resetprop-rs.'
				: 'A reboot is needed for the boot scripts to use it.',
		]
			.filter(Boolean)
			.join('\n\n');
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

export async function refreshSettings(root: HTMLElement): Promise<void> {
	applySettingsConfig(root, await getConfig());
}

export function applySettingsConfig(root: HTMLElement, config: Config): void {
	root.querySelectorAll<HTMLInputElement>('[data-key][data-type]').forEach((el) => {
		const key = el.dataset.key;
		const value = key ? config[key] : undefined;
		if (el.dataset.type === 'bool') {
			el.checked = value === '1';
		} else {
			el.value = value ?? '';
		}
	});
}
