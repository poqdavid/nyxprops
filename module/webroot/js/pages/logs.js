import { t } from '../i18n.js';
import { getLog, LOG_PATH } from '../props-data.js';

// This boot's log: what NyxProps did at each boot stage. Read on the first
// visit to the page rather than at startup - it can run to hundreds of
// lines and opening the WebUI doesn't need it.

export function renderLogsShell(root) {
	root.innerHTML = `
		<h2 class="section-title">${t('logs_tab_activity', 'Activity')}</h2>
		<div class="card">
			<p class="log-note" data-role="note" hidden></p>
			<div class="log-view is-empty" data-role="log">${t('logs_loading', 'Loading…')}</div>
		</div>
		<p class="setting-row__desc page-footnote">${t('logs_activity_desc', 'What NyxProps did at each boot stage: the backend it used, each preset it ran or skipped, and every prop it changed.')} ${t('logs_hint', 'The log is rewritten at every boot. Newest at the bottom. Tap refresh in the top bar to reload.')}<br><code>${LOG_PATH}</code></p>
	`;
}

// Newest lines are what you came for.
function scrollToNewest(el) {
	requestAnimationFrame(() => {
		el.scrollTop = el.scrollHeight;
	});
}

export async function refreshLogs(root) {
	renderLogs(root, await getLog());
}

/** Fill the log view from a getLog() result. */
export function renderLogs(root, { text, total }) {
	const el = root.querySelector('[data-role="log"]');
	const note = root.querySelector('[data-role="note"]');
	const body = text.trim();
	el.classList.toggle('is-empty', !body);
	if (body) {
		// One row per line, so a long prop value that wraps is indented under
		// its own entry instead of reading like the start of the next.
		const rows = document.createDocumentFragment();
		for (const line of body.split('\n')) {
			const row = document.createElement('div');
			row.className = 'log-line';
			row.textContent = line || ' ';
			rows.append(row);
		}
		el.replaceChildren(rows);
	} else {
		el.textContent = t('logs_empty', 'Nothing logged this boot yet.');
	}
	// Only the end of a long log is shown; say so.
	const shown = body ? body.split('\n').length : 0;
	note.hidden = total <= shown;
	note.textContent = total > shown
		? t('logs_truncated', 'Showing the last {shown} of {total} lines.').replace('{shown}', shown).replace('{total}', total)
		: '';
	scrollToNewest(el);
}
