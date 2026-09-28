import { icons } from '../icons.js';
import { getBootState, getCategoryEntries, listPropPresets, getDeviceInfo, getVerification } from '../props-data.js';
import { openSheetLoading, openSheetWithList } from '../sheet.js';
import { t } from '../i18n.js';

// Verification rows: how each key from getVerification() is labelled and how
// its value is rendered. `fmt` turns the raw value into display text.
const VERIFY_META = {
	vbs: { i18n: 'home_verify_vbs', label: 'Verified boot state', fmt: (v) => v },
	bootloader: {
		i18n: 'home_verify_bootloader', label: 'Bootloader',
		fmt: (v) => (v === 'locked' ? t('home_verify_locked', 'Locked') : v === 'unlocked' ? t('home_verify_unlocked', 'Unlocked') : v),
	},
	verity: { i18n: 'home_verify_verity', label: 'dm-verity', fmt: (v) => v },
	spl: { i18n: 'home_verify_spl', label: 'Security patch', fmt: (v) => v },
};

const BACKEND_LABELS = {
	rs: 'resetprop-rs',
	magisk: 'stock resetprop',
};

function checkRowHtml(item) {
	const meta = VERIFY_META[item.key];
	if (!meta) return '';
	const label = t(meta.i18n, meta.label);
	const value = meta.fmt(item.value);
	let mark = '';
	if (item.ok === true) mark = `<span class="check-row__mark is-ok">${icons.check}</span>`;
	else if (item.ok === false) mark = `<span class="check-row__mark is-warn">${icons.error}</span>`;
	return `
		<div class="check-row">
			<span class="check-row__label">${label}</span>
			<span class="check-row__value">${value ?? '—'}</span>
			${mark}
		</div>`;
}

function infoRowHtml(label, value) {
	return `
		<div class="info-row">
			<span class="info-row__label">${label}</span>
			<span class="info-row__value">${value ?? '—'}</span>
		</div>`;
}

export function renderHomeShell(root) {
	root.innerHTML = `
		<div data-role="status"></div>
		<h2 class="section-title">${t('home_verify_title', 'Verification')}</h2>
		<div class="card" data-role="verify"></div>
		<h2 class="section-title">${t('home_stats_title', 'This boot')}</h2>
		<div class="stat-grid" data-role="stats"></div>
		<h2 class="section-title">${t('home_device_title', 'Device')}</h2>
		<div class="card" data-role="device"></div>
	`;
	root.querySelector('[data-role="stats"]').addEventListener('click', async (e) => {
		const btn = e.target.closest('.stat-card');
		if (!btn) return;
		if (btn.dataset.category === 'applied') {
			const title = t('home_stat_applied', 'props applied');
			openSheetLoading(title);
			const [boot, entries] = await Promise.all([getBootState(), getCategoryEntries('prop')]);
			openSheetWithList(title, boot.current ? entries : [], boot.current
				? t('home_stat_applied_empty', 'No props were applied this boot. Either every preset is disabled, or none of their rules matched this device.')
				: t('home_stat_applied_none', "The presets haven't run this boot."));
		} else if (btn.dataset.category === 'presets') {
			const title = t('home_stat_presets', 'presets enabled');
			openSheetLoading(title);
			const presets = await listPropPresets();
			openSheetWithList(title, presets.filter((p) => p.enabled).map((p) => `${p.name} (${p.file})`),
				t('home_stat_presets_empty', 'No presets are enabled.'));
		}
	});
}

export async function refreshHome(root) {
	const [boot, logged, presets, verify, device] = await Promise.all([
		getBootState(), getCategoryEntries('prop'), listPropPresets(), getVerification(), getDeviceInfo(),
	]);
	const enabled = presets.filter((p) => p.enabled).length;
	// Only count what this boot applied; a log from an earlier boot is stale.
	const applied = boot.current ? logged : [];

	const statusEl = root.querySelector('[data-role="status"]');
	if (boot.current) {
		const backend = BACKEND_LABELS[boot.backend] ?? t('home_props_backend_unknown', 'backend unknown');
		statusEl.innerHTML = `
			<div class="status-card">
				<div class="status-card__icon">${icons.check}</div>
				<div>
					<div class="status-card__title">${t('home_props_active', 'Presets applied')}</div>
					<div class="status-card__subtitle">${enabled}/${presets.length} ${t('home_props_enabled', 'presets enabled')} · ${backend}</div>
				</div>
			</div>`;
	} else {
		const title = boot.booted
			? t('home_props_stale', 'Not applied this boot')
			: t('home_props_waiting', 'Not applied yet');
		const hint = boot.booted
			? t('home_props_stale_hint', 'The presets ran on an earlier boot but not this one. Check the module is enabled, then reboot.')
			: t('home_props_waiting_hint', 'Reboot to apply the enabled presets.');
		statusEl.innerHTML = `
			<div class="status-card is-error">
				<div class="status-card__icon">${icons.error}</div>
				<div>
					<div class="status-card__title">${title}</div>
					<div class="status-card__subtitle">${hint}</div>
				</div>
			</div>`;
	}

	root.querySelector('[data-role="verify"]').innerHTML = verify.map(checkRowHtml).join('');

	root.querySelector('[data-role="device"]').innerHTML = [
		infoRowHtml(t('home_device_model', 'Model'), device.model),
		infoRowHtml(t('home_device_android', 'Android'), device.android),
	].join('');

	root.querySelector('[data-role="stats"]').innerHTML = `
		<button class="stat-card" data-category="applied">
			<span class="stat-card__value">${applied.length}</span>
			<span class="stat-card__label">${t('home_stat_applied', 'props applied')}</span>
		</button>
		<button class="stat-card" data-category="presets">
			<span class="stat-card__value">${enabled}</span>
			<span class="stat-card__label">${t('home_stat_presets', 'presets enabled')}</span>
		</button>
	`;
}
