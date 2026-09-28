import { getPropsData, getPropPreset, setPropPreset, setPropPresetEnabled, deletePropPreset, sanitisePresetFilename, type Preset, type PropsData } from '../props-data';
import { $, closestTarget, escapeHtml } from '../core/dom';
import { toast, nextPaint } from '../core/ksu-bridge';
import { openSheetLoading, openSheetWithList } from '../core/sheet';
import { confirmDialog, promptDialog } from '../core/dialog';

let lastApplied: string[] | null = null;

function presetsChanged(): void {
	document.dispatchEvent(new CustomEvent('nyx:presets-changed'));
}

function applyEnabledHeader(text: string, enabled: boolean): string {
	const val = enabled ? '1' : '0';
	const lines = text.split('\n');
	let end = 0;
	while (end < lines.length && (lines[end] ?? '').startsWith('#')) {
		if (/^#[ \t]*enabled:/.test(lines[end] ?? '')) {
			lines[end] = `# enabled: ${val}`;
			return lines.join('\n');
		}
		end += 1;
	}
	lines.splice(end, 0, `# enabled: ${val}`);
	return lines.join('\n');
}

const NEW_PRESET_TEMPLATE = `# name: My preset
# description: What this preset does
# enabled: 1

# Optional headers. Headers are read only from the block of # lines at
# the very top, so add them next to name/description/enabled, before
# the first blank line:
#   stage: post-fs-data     run BEFORE zygote. Needed for build-identity
#                           props the framework caches into android.os.Build
#                           (ro.build.type, ro.build.fingerprint,
#                           ro.build.version.security_patch, ro.debuggable),
#                           so the Java value matches the property.
#   stage: boot-completed   run from KernelSU's boot-completed stage. It
#                           starts when Android finishes booting, side by
#                           side with the default stage below.
#   (no stage header)       the service stage: waits until Android has
#                           finished booting, then applies, so the
#                           system's own boot-time writes can't undo it.
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
#   {vendor_patch}    current YYYY-MM-05, rolled back a month until the 5th
#                     arrives, so it never names a future date

# reset  ro.example.prop  somevalue
`;

export function renderPropsShell(root: HTMLElement): void {
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
			Presets are applied in filename order, at the service stage (once
			Android has finished booting) unless they say otherwise. Changes take
			effect on the next reboot.
		</p>
	`;

	$(root, '[data-role="applied"]').addEventListener('click', async () => {
		let entries = lastApplied;
		if (!entries) {
			openSheetLoading('Props applied this boot');
			await nextPaint();
			entries = (await getPropsData()).applied;
		}
		openSheetWithList('Props applied this boot', entries, 'No props were applied this boot. Either every preset is disabled, or none of their rules matched this device.');
	});

	$(root, '[data-role="new"]').addEventListener('click', async () => {
		const name = await promptDialog(
			'New preset',
			'Filename for the preset. Letters, numbers, . _ - only. Presets apply in filename order, so a numeric prefix controls when it runs.',
			'99-custom',
		);
		if (!name) return;
		const file = sanitisePresetFilename(name);
		if (!file) {
			toast('That name has no usable characters');
			return;
		}
		await nextPaint();
		const existing = await getPropPreset(file);
		if (existing) {
			toast(`${file} already exists`);
			return;
		}
		const { ok } = await setPropPreset(file, NEW_PRESET_TEMPLATE);
		toast(ok ? `Created ${file}` : `Failed to create ${file}`);
		if (ok) {
			presetsChanged();
			refreshProps(root);
		}
	});

	const listEl = $(root, '[data-role="list"]');

	listEl.addEventListener('change', async (e) => {
		const input = closestTarget<HTMLInputElement>(e, 'input[data-file]');
		if (!input) return;
		const file = input.dataset.file;
		if (!file) return;
		await nextPaint();
		const { ok } = await setPropPresetEnabled(file, input.checked);
		if (ok) {
			toast(`${input.checked ? 'Enabled' : 'Disabled'} — reboot to apply`);
			const details = listEl.querySelector<HTMLDetailsElement>(`details[data-file="${file}"]`);
			if (details && details.dataset.loaded) {
				const ta = $<HTMLTextAreaElement>(details, '[data-role="editor"]');
				ta.value = applyEnabledHeader(ta.value, input.checked);
			}
			presetsChanged();
		} else {
			toast('Failed to update preset');
			input.checked = !input.checked;
		}
	});

	listEl.addEventListener(
		'toggle',
		async (e) => {
			const details = e.target as HTMLDetailsElement;
			if (details.tagName !== 'DETAILS' || !details.open || details.dataset.loaded) return;
			const file = details.dataset.file;
			if (!file) return;
			const textarea = $<HTMLTextAreaElement>(details, '[data-role="editor"]');
			await nextPaint();
			textarea.value = await getPropPreset(file);
			details.dataset.loaded = '1';
		},
		true,
	);

	listEl.addEventListener('click', async (e) => {
		const details = closestTarget<HTMLDetailsElement>(e, 'details');
		if (!details) return;
		const file = details.dataset.file;
		if (!file) return;
		const roleEl = e.target instanceof HTMLElement ? e.target : null;
		const role = roleEl?.dataset.role;

		if (role === 'save') {
			const textarea = $<HTMLTextAreaElement>(details, '[data-role="editor"]');
			await nextPaint();
			const { ok } = await setPropPreset(file, textarea.value);
			toast(ok ? `Saved ${file} — reboot to apply` : `Failed to save ${file}`);
			if (ok) {
				presetsChanged();
				refreshProps(details.closest('.page'));
			}
		}

		if (role === 'delete') {
			const sure = await confirmDialog('Delete preset', `Delete ${file}? This can't be undone.`, 'Delete');
			if (!sure) return;
			await nextPaint();
			const { ok } = await deletePropPreset(file);
			toast(ok ? `Deleted ${file}` : `Failed to delete ${file}`);
			if (ok) {
				presetsChanged();
				refreshProps(details.closest('.page'));
			}
		}
	});
}

export async function refreshProps(root: HTMLElement | null): Promise<void> {
	if (!root) return;
	renderProps(root, await getPropsData());
}

export function renderProps(root: HTMLElement, { presets, applied }: PropsData): void {
	lastApplied = applied;
	$(root, '[data-role="applied-count"]').textContent = String(applied.length);

	const listEl = $(root, '[data-role="list"]');
	if (!presets.length) {
		listEl.innerHTML = `<div class="empty-hint">No presets found in the props directory.<br>Reinstall the module to restore the defaults.</div>`;
		return;
	}

	listEl.innerHTML = presets
		.map(
			(p) => `
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
					<input type="checkbox" data-file="${escapeHtml(p.file)}" ${p.enabled ? 'checked' : ''}>
					<span class="m3-switch__track"></span>
					<span class="m3-switch__thumb"></span>
				</label>
			</div>
			<details data-file="${escapeHtml(p.file)}" style="padding:0 0 12px;">
				<summary class="setting-row__desc" style="cursor:pointer; padding:4px 0;">Edit rules</summary>
				<textarea class="list-editor" data-role="editor" spellcheck="false"></textarea>
				<div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
					<button class="btn btn--text" data-role="delete">Delete</button>
					<button class="btn btn--tonal" data-role="save">Save</button>
				</div>
			</details>
		</div>
	`,
		)
		.join('');
}

function presetMeta(p: Preset): string {
	const bits = [`${p.ruleCount} rule${p.ruleCount === 1 ? '' : 's'}`, p.file];
	if (p.stage && p.stage !== 'service') bits.push(`runs at ${p.stage}`);
	if (p.minSdk && p.maxSdk) bits.push(`SDK ${p.minSdk}-${p.maxSdk}`);
	else if (p.minSdk) bits.push(`SDK ${p.minSdk}+`);
	else if (p.maxSdk) bits.push(`SDK ${p.maxSdk} and below`);
	return bits.map(escapeHtml).join(' · ');
}
