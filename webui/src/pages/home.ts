import { icons } from '../core/icons';
import { $, closestTarget } from '../core/dom';
import { getHomeData, type HomeData, type VerifyItem } from '../props-data';
import { openSheetLoading, openSheetWithList } from '../core/sheet';
import { nextPaint } from '../core/ksu-bridge';
import { t } from '../core/i18n';

export interface HomeNotice {
	kind: 'info' | 'warn';
	title: string;
	subtitle?: string;
	actionLabel?: string;
	onAction?: (btn: HTMLButtonElement) => void;
}

let lastData: HomeData | null = null;

document.addEventListener('nyx:presets-changed', () => {
	lastData = null;
});

export function setHomeNotice(notice: HomeNotice | null): void {
	const host = document.querySelector('#page-home [data-role="notice"]');
	if (!host) return;
	host.innerHTML = '';
	if (!notice) return;

	const card = document.createElement('div');
	card.className = `notice-card${notice.kind === 'warn' ? ' is-warn' : ''}`;
	const text = document.createElement('div');
	text.className = 'notice-card__text';
	const title = document.createElement('div');
	title.className = 'notice-card__title';
	title.textContent = notice.title;
	text.appendChild(title);
	if (notice.subtitle) {
		const sub = document.createElement('div');
		sub.className = 'notice-card__subtitle';
		sub.textContent = notice.subtitle;
		text.appendChild(sub);
	}
	card.appendChild(text);
	if (notice.actionLabel && notice.onAction) {
		const onAction = notice.onAction;
		const btn = document.createElement('button');
		btn.className = 'btn btn--tonal notice-card__action';
		btn.textContent = notice.actionLabel;
		btn.addEventListener('click', () => onAction(btn));
		card.appendChild(btn);
	}
	host.appendChild(card);
}

const VERIFY_META: Record<string, { i18n: string; label: string; fmt: (v: string) => string }> = {
	vbs: { i18n: 'home_verify_vbs', label: 'Verified boot state', fmt: (v) => v },
	bootloader: {
		i18n: 'home_verify_bootloader',
		label: 'Bootloader',
		fmt: (v) => (v === 'locked' ? t('home_verify_locked', 'Locked') : v === 'unlocked' ? t('home_verify_unlocked', 'Unlocked') : v),
	},
	verity: { i18n: 'home_verify_verity', label: 'dm-verity', fmt: (v) => v },
	spl: { i18n: 'home_verify_spl', label: 'Security patch', fmt: (v) => v },
};

const BACKEND_LABELS: Record<string, string> = {
	rs: 'resetprop-rs',
	magisk: 'stock resetprop',
};

function checkRowHtml(item: VerifyItem): string {
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
			<span class="check-row__value">${value || '—'}</span>
			${mark}
		</div>`;
}

function infoRowHtml(label: string, value: string | null): string {
	return `
		<div class="info-row">
			<span class="info-row__label">${label}</span>
			<span class="info-row__value">${value ?? '—'}</span>
		</div>`;
}

export function renderHomeShell(root: HTMLElement): void {
	root.innerHTML = `
		<div data-role="status"></div>
		<div data-role="notice"></div>
		<h2 class="section-title">${t('home_verify_title', 'Verification')}</h2>
		<div class="card" data-role="verify"></div>
		<h2 class="section-title">${t('home_stats_title', 'This boot')}</h2>
		<div class="stat-grid" data-role="stats"></div>
		<h2 class="section-title">${t('home_device_title', 'Device')}</h2>
		<div class="card" data-role="device"></div>
	`;
	$(root, '[data-role="stats"]').addEventListener('click', async (e) => {
		const btn = closestTarget(e, '.stat-card');
		if (!btn) return;
		const category = btn.dataset.category;
		const title = category === 'applied' ? t('home_stat_applied', 'props applied') : t('home_stat_presets', 'presets enabled');
		let data = lastData;
		if (!data) {
			openSheetLoading(title);
			await nextPaint();
			data = await getHomeData();
		}
		if (category === 'applied') {
			const { boot, applied } = data;
			openSheetWithList(
				title,
				boot.current ? applied : [],
				boot.current
					? t('home_stat_applied_empty', 'No props were applied this boot. Either every preset is disabled, or none of their rules matched this device.')
					: t('home_stat_applied_none', "The presets haven't run this boot."),
			);
		} else if (category === 'presets') {
			openSheetWithList(
				title,
				data.presets.filter((p) => p.enabled).map((p) => `${p.name} (${p.file})`),
				t('home_stat_presets_empty', 'No presets are enabled.'),
			);
		}
	});
}

export async function refreshHome(root: HTMLElement): Promise<void> {
	renderHome(root, await getHomeData());
}

export function renderHome(root: HTMLElement, data: HomeData): void {
	lastData = data;
	const { boot, applied: logged, presets, verify, device } = data;
	const enabled = presets.filter((p) => p.enabled).length;
	const applied = boot.current ? logged : [];

	const statusEl = $(root, '[data-role="status"]');
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
		const title = boot.booted ? t('home_props_stale', 'Not applied this boot') : t('home_props_waiting', 'Not applied yet');
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

	$(root, '[data-role="verify"]').innerHTML = verify.map(checkRowHtml).join('');

	$(root, '[data-role="device"]').innerHTML = [
		infoRowHtml(t('home_device_model', 'Model'), device.model),
		infoRowHtml(t('home_device_android', 'Android'), device.android),
	].join('');

	$(root, '[data-role="stats"]').innerHTML = `
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
