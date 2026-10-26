import { t } from '../core/i18n';
import { $ } from '../core/dom';
import { getLog, LOG_PATH, type LogData } from '../props-data';

export function renderLogsShell(root: HTMLElement): void {
	root.innerHTML = `
		<h2 class="section-title">${t('logs_tab_activity', 'Activity')}</h2>
		<div class="card">
			<p class="log-note" data-role="note" hidden></p>
			<div class="log-view is-empty" data-role="log">${t('logs_loading', 'Loading…')}</div>
		</div>
		<p class="setting-row__desc page-footnote">${t('logs_activity_desc', 'What NyxProps did at each boot stage: the backend it used, each preset it ran or skipped, every prop it changed, and any write that failed.')} ${t('logs_hint', 'The log is rewritten at every boot. Newest at the bottom. Tap refresh in the top bar to reload.')}<br><code>${LOG_PATH}</code></p>
	`;
}

function scrollToNewest(el: HTMLElement): void {
	requestAnimationFrame(() => {
		el.scrollTop = el.scrollHeight;
	});
}

export async function refreshLogs(root: HTMLElement): Promise<void> {
	renderLogs(root, await getLog());
}

export function renderLogs(root: HTMLElement, { text, total }: LogData): void {
	const el = $(root, '[data-role="log"]');
	const note = $(root, '[data-role="note"]');
	const body = text.trim();
	el.classList.toggle('is-empty', !body);
	if (body) {
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
	const shown = body ? body.split('\n').length : 0;
	note.hidden = total <= shown;
	note.textContent = total > shown ? t('logs_truncated', 'Showing the last {shown} of {total} lines.').replace('{shown}', String(shown)).replace('{total}', String(total)) : '';
	scrollToNewest(el);
}
