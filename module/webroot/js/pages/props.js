import {
	getPropsData,
	getPropPreset,
	setPropPreset,
	setPropPresetEnabled,
	deletePropPreset,
	sanitisePresetFilename,
} from '../props-data.js';
import { toast, nextPaint } from '../ksu-bridge.js';
import { openSheetLoading, openSheetWithList } from '../sheet.js';
import { confirmDialog, promptDialog } from '../dialog.js';

// The applied-props list behind the card at the top, from the same read
// its count came from, so the card opens instantly.
let lastApplied = null;

// Home counts and lists the enabled presets, and pages keep what they
// rendered across tab switches, so any change here tells the app to have
// Home re-read on its next visit.
function presetsChanged() {
	document.dispatchEvent(new CustomEvent('nyx:presets-changed'));
}

/**
 * Set the "# enabled:" line in preset text to match a switch, the same way
 * setPropPresetEnabled rewrites the file: replace the first matching header,
 * or append one if the preset has none. Used to keep an open editor's
 * textarea in step with its toggle.
 */
function applyEnabledHeader(text, enabled) {
	const val = enabled ? '1' : '0';
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i += 1) {
		if (/^#[ \t]*enabled:/.test(lines[i])) {
			lines[i] = `# enabled: ${val}`;
			return lines.join('\n');
		}
	}
	lines.push(`# enabled: ${val}`);
	return lines.join('\n');
}

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
		let entries = lastApplied;
		if (!entries) {
			openSheetLoading('Props applied this boot');
			await nextPaint();
			entries = (await getPropsData()).applied;
		}
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
		// Let the dialog close on screen before the shell calls hold the page.
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

	const listEl = root.querySelector('[data-role="list"]');

	// Toggling enabled/disabled
	listEl.addEventListener('change', async (e) => {
		const input = e.target.closest('input[data-file]');
		if (!input) return;
		// Show the flipped switch first; the write holds the page.
		await nextPaint();
		const { ok } = await setPropPresetEnabled(input.dataset.file, input.checked);
		if (ok) {
			toast(`${input.checked ? 'Enabled' : 'Disabled'} — reboot to apply`);
			// If this preset's editor is open, its textarea was loaded before
			// the toggle and still holds the old "# enabled:" line. Patch it to
			// match, or a later Save would write the old header back and undo
			// the toggle. Any unsaved rule edits in the textarea are kept.
			const details = listEl.querySelector(`details[data-file="${input.dataset.file}"]`);
			if (details && details.dataset.loaded) {
				const ta = details.querySelector('[data-role="editor"]');
				ta.value = applyEnabledHeader(ta.value, input.checked);
			}
			presetsChanged();
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
		// Let the editor open on screen before the read holds the page.
		await nextPaint();
		textarea.value = await getPropPreset(details.dataset.file);
		details.dataset.loaded = '1';
	}, true);

	listEl.addEventListener('click', async (e) => {
		const details = e.target.closest('details');
		if (!details) return;
		const file = details.dataset.file;

		if (e.target.dataset.role === 'save') {
			const textarea = details.querySelector('[data-role="editor"]');
			await nextPaint();
			const { ok } = await setPropPreset(file, textarea.value);
			toast(ok ? `Saved ${file} — reboot to apply` : `Failed to save ${file}`);
			if (ok) {
				presetsChanged();
				refreshProps(details.closest('.page'));
			}
		}

		if (e.target.dataset.role === 'delete') {
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

export async function refreshProps(root) {
	if (!root) return;
	renderProps(root, await getPropsData());
}

/** Fill the page from a getPropsData() result (also used at startup). */
export function renderProps(root, { presets, applied }) {
	lastApplied = applied;
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
