import {
	listPropPresets,
	getPropPreset,
	setPropPreset,
	setPropPresetEnabled,
	deletePropPreset,
	sanitisePresetFilename,
	getCategoryEntries,
} from '../props-data.js';
import { toast } from '../ksu-bridge.js';
import { openSheetLoading, openSheetWithList } from '../sheet.js';
import { confirmDialog, promptDialog } from '../dialog.js';

const NEW_PRESET_TEMPLATE = `# name: My preset
# description: What this preset does
# enabled: 1

# Optional headers:
#   stage: boot-completed   run later than the default service stage.
#                           Needed for props init writes as services
#                           start (init.svc.*, service.adb.*) - at the
#                           service stage they don't exist yet.
#   min_sdk: 36             only run on this Android API level or above
#   max_sdk: 35             only run on this Android API level or below
# To re-apply a preset periodically (for a prop something RESETS after
# boot) add a header line reading exactly:  repeat: 120  (N seconds, no
# leading words). Off unless added. It starts one background process,
# which is itself detectable, so only use it for a prop you've confirmed
# reverts. Clamped to repeat_min_interval in config.sh.

# format: <mode> <prop> <value>
#   missing        set only if the prop is absent
#   reset          set only if present AND different (never creates)
#   missing_match  set if absent, or present and different
#   contains       <prop> <needle> <value>  (replace the WHOLE value if
#                                            it contains needle)
#   clear          <prop>                   (blank it if it has a value)
#   delete         <prop>                   (remove it entirely - not the
#                                            same as clear)
#   replace        <prop> <needle> [value]  (rewrite a substring of the
#                                            current value; omit value to
#                                            delete the substring)
#   delete_matching <ere>                   (delete every prop whose NAME
#                                            matches the pattern)
#   same_as        <prop> <source-prop>     (set prop to another prop's
#                                            live value; only if prop
#                                            already exists; multi-word safe)
#
# Value tokens (resolved when the preset is applied):
#   {avb_version}     device AVB version     {vbmeta_size}   configured vbmeta size
#   {security_patch}  current YYYY-MM-01     {yyyy_mm}       current YYYY-MM

# reset  ro.example.prop  somevalue
`;

export function renderPropsShell(root) {
	root.innerHTML = `
		<button class="stat-card" data-role="applied" style="width:100%; margin-bottom:4px;">
			<span class="stat-card__value" data-role="applied-count">—</span>
			<span class="stat-card__label">props applied this boot</span>
		</button>

		<h2 class="section-title">Presets</h2>
		<div data-role="list"></div>

		<div style="display:flex; justify-content:flex-end; margin-top:12px;">
			<button class="btn btn--tonal" data-role="new">New preset</button>
		</div>

		<p class="setting-row__desc" style="margin:16px 4px 0;">
			Presets are applied in filename order, at the service stage unless
			they say otherwise. Changes take effect on the next reboot.
		</p>
	`;

	root.querySelector('[data-role="applied"]').addEventListener('click', async () => {
		openSheetLoading('Props applied this boot');
		const entries = await getCategoryEntries('prop');
		openSheetWithList('Props applied this boot', entries,
			'No props were applied this boot. Either every preset is disabled, or none of their rules matched this device.');
	});

	root.querySelector('[data-role="new"]').addEventListener('click', async () => {
		const name = await promptDialog(
			'New preset',
			'Filename for the preset. Letters, numbers, . _ - only. Presets apply in filename order, so a numeric prefix controls when it runs.',
			'99-custom'
		);
		if (!name) return;
		const file = sanitisePresetFilename(name);
		if (!file) {
			toast('That name has no usable characters');
			return;
		}
		const existing = await getPropPreset(file);
		if (existing) {
			toast(`${file} already exists`);
			return;
		}
		const { ok } = await setPropPreset(file, NEW_PRESET_TEMPLATE);
		toast(ok ? `Created ${file}` : `Failed to create ${file}`);
		if (ok) refreshProps(root);
	});

	const listEl = root.querySelector('[data-role="list"]');

	// Toggling enabled/disabled
	listEl.addEventListener('change', async (e) => {
		const input = e.target.closest('input[data-file]');
		if (!input) return;
		const { ok } = await setPropPresetEnabled(input.dataset.file, input.checked);
		if (ok) {
			toast(`${input.checked ? 'Enabled' : 'Disabled'} — reboot to apply`);
		} else {
			toast('Failed to update preset');
			input.checked = !input.checked;
		}
	});

	// Lazy-load the editor body only when a preset is expanded
	listEl.addEventListener('toggle', async (e) => {
		const details = e.target;
		if (details.tagName !== 'DETAILS' || !details.open || details.dataset.loaded) return;
		const textarea = details.querySelector('[data-role="editor"]');
		textarea.value = await getPropPreset(details.dataset.file);
		details.dataset.loaded = '1';
	}, true);

	listEl.addEventListener('click', async (e) => {
		const details = e.target.closest('details');
		if (!details) return;
		const file = details.dataset.file;

		if (e.target.dataset.role === 'save') {
			const textarea = details.querySelector('[data-role="editor"]');
			const { ok } = await setPropPreset(file, textarea.value);
			toast(ok ? `Saved ${file} — reboot to apply` : `Failed to save ${file}`);
			if (ok) refreshProps(details.closest('.page'));
		}

		if (e.target.dataset.role === 'delete') {
			const sure = await confirmDialog('Delete preset', `Delete ${file}? This can't be undone.`, 'Delete');
			if (!sure) return;
			const { ok } = await deletePropPreset(file);
			toast(ok ? `Deleted ${file}` : `Failed to delete ${file}`);
			if (ok) refreshProps(details.closest('.page'));
		}
	});
}

export async function refreshProps(root) {
	if (!root) return;
	const [presets, applied] = await Promise.all([
		listPropPresets(),
		getCategoryEntries('prop'),
	]);

	root.querySelector('[data-role="applied-count"]').textContent = applied.length;

	const listEl = root.querySelector('[data-role="list"]');
	if (!presets.length) {
		listEl.innerHTML = `<div class="empty-hint">No presets found in the props directory.<br>Reinstall the module to restore the defaults.</div>`;
		return;
	}

	listEl.innerHTML = presets.map((p) => `
		<div class="card" style="padding:4px 16px;">
			<div class="setting-row" style="border-bottom:none;">
				<div class="setting-row__text">
					<div class="setting-row__title">${escapeHtml(p.name)}</div>
					<div class="setting-row__desc">${escapeHtml(p.description)}</div>
					<div class="setting-row__desc" style="opacity:.7; margin-top:4px;">
						${presetMeta(p)}
					</div>
				</div>
				<label class="m3-switch">
					<input type="checkbox" data-file="${escapeAttr(p.file)}" ${p.enabled ? 'checked' : ''}>
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
			<details data-file="${escapeAttr(p.file)}" style="padding:0 0 12px;">
				<summary class="setting-row__desc" style="cursor:pointer; padding:4px 0;">Edit rules</summary>
				<textarea class="list-editor" data-role="editor" spellcheck="false"></textarea>
				<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
					<button class="btn btn--text" data-role="delete">Delete</button>
					<button class="btn btn--tonal" data-role="save">Save</button>
				</div>
			</details>
		</div>
	`).join('');
}

/** Row subtitle. Surfaces the stage and any SDK gate, because a preset
 *  that is enabled but gated out on this device otherwise looks like a
 *  toggle that does nothing. */
function presetMeta(p) {
	const bits = [`${p.ruleCount} rule${p.ruleCount === 1 ? '' : 's'}`, p.file];
	if (p.stage && p.stage !== 'service') bits.push(`runs at ${p.stage}`);
	if (p.minSdk && p.maxSdk) bits.push(`SDK ${p.minSdk}-${p.maxSdk}`);
	else if (p.minSdk) bits.push(`SDK ${p.minSdk}+`);
	else if (p.maxSdk) bits.push(`SDK ${p.maxSdk} and below`);
	return bits.map(escapeHtml).join(' · ');
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
	return escapeHtml(s);
}
