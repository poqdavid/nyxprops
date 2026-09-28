import { icons } from './icons.js';

let scrimEl, sheetEl, titleEl, bodyEl;

function ensureMounted() {
	if (scrimEl) return;
	scrimEl = document.createElement('div');
	scrimEl.className = 'sheet-scrim';
	sheetEl = document.createElement('div');
	sheetEl.className = 'sheet';
	sheetEl.innerHTML = `
		<div class="sheet__handle"></div>
		<div class="sheet__header">
			<span data-role="title"></span>
			<button class="icon-btn" data-role="close" aria-label="Close">${icons.close}</button>
		</div>
		<div class="sheet__body" data-role="body"></div>
	`;
	document.body.append(scrimEl, sheetEl);
	titleEl = sheetEl.querySelector('[data-role="title"]');
	bodyEl = sheetEl.querySelector('[data-role="body"]');
	scrimEl.addEventListener('click', closeSheet);
	sheetEl.querySelector('[data-role="close"]').addEventListener('click', closeSheet);
}

export function closeSheet() {
	if (!scrimEl) return;
	scrimEl.classList.remove('open');
	sheetEl.classList.remove('open');
}

/**
 * @param {string} title
 * @param {string[]} entries - plain strings (paths) to list, or [] for empty state
 * @param {string} [emptyMessage]
 */
export function openSheetWithList(title, entries, emptyMessage = 'Nothing recorded for this boot yet.') {
	ensureMounted();
	titleEl.textContent = title;
	if (!entries.length) {
		bodyEl.innerHTML = `<div class="sheet__empty">${emptyMessage}</div>`;
	} else {
		bodyEl.innerHTML = `<ul class="sheet__list">${entries.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
	}
	requestAnimationFrame(() => {
		scrimEl.classList.add('open');
		sheetEl.classList.add('open');
	});
}

/**
 * Render grouped results: [{ label, items }]. Group headers are only shown
 * when there's more than one group, so a single-source list stays clean.
 * @param {string} title
 * @param {{label:string, items:string[]}[]} groups
 */
export function openSheetWithGroups(title, groups, emptyMessage = 'Nothing recorded for this boot yet.') {
	ensureMounted();
	titleEl.textContent = title;
	const total = groups.reduce((n, g) => n + g.items.length, 0);
	if (!total) {
		bodyEl.innerHTML = `<div class="sheet__empty">${emptyMessage}</div>`;
	} else {
		bodyEl.innerHTML = groups
			.filter((g) => g.items.length)
			.map((g) => {
				const header = groups.filter((x) => x.items.length).length > 1
					? `<div class="sheet__group">${escapeHtml(g.label)} (${g.items.length})</div>`
					: '';
				return `${header}<ul class="sheet__list">${g.items.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
			})
			.join('');
	}
	requestAnimationFrame(() => {
		scrimEl.classList.add('open');
		sheetEl.classList.add('open');
	});
}

export function openSheetLoading(title) {
	ensureMounted();
	titleEl.textContent = title;
	bodyEl.innerHTML = `<div class="sheet__empty">Loading…</div>`;
	requestAnimationFrame(() => {
		scrimEl.classList.add('open');
		sheetEl.classList.add('open');
	});
}

function escapeHtml(s) {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
