// In-page replacements for window.confirm / window.prompt.
//
// An Android WebView only shows native JS dialogs if the host app installs
// a WebChromeClient that handles onJsConfirm / onJsPrompt. We can't rely on
// the manager doing that: without it, confirm() silently returns false and
// prompt() silently returns null, so a "Delete" would quietly do nothing
// and "New preset" would quietly create nothing. These render into the page
// instead, so they work regardless of the host.

let scrimEl;
let dialogEl;
let resolveFn = null;

function ensureMounted() {
	if (scrimEl) return;
	scrimEl = document.createElement('div');
	scrimEl.className = 'dialog-scrim';
	dialogEl = document.createElement('div');
	dialogEl.className = 'dialog';
	scrimEl.appendChild(dialogEl);
	document.body.appendChild(scrimEl);
	scrimEl.addEventListener('click', (e) => {
		if (e.target === scrimEl) settle(null);
	});
}

function settle(value) {
	if (!resolveFn) return;
	const fn = resolveFn;
	resolveFn = null;
	scrimEl.classList.remove('open');
	fn(value);
}

function open(innerHtml, wire) {
	ensureMounted();
	dialogEl.innerHTML = innerHtml;
	return new Promise((resolve) => {
		resolveFn = resolve;
		wire();
		requestAnimationFrame(() => scrimEl.classList.add('open'));
	});
}

/** @returns {Promise<boolean>} */
export function confirmDialog(title, message, confirmLabel = 'Confirm') {
	return open(
		`
		<h3 class="dialog__title">${escapeHtml(title)}</h3>
		<p class="dialog__body">${escapeHtml(message)}</p>
		<div class="dialog__actions">
			<button class="btn btn--text" data-role="cancel">Cancel</button>
			<button class="btn btn--filled" data-role="ok">${escapeHtml(confirmLabel)}</button>
		</div>`,
		() => {
			dialogEl.querySelector('[data-role="cancel"]').onclick = () => settle(false);
			dialogEl.querySelector('[data-role="ok"]').onclick = () => settle(true);
		}
	).then((v) => v === true);
}

/** @returns {Promise<string|null>} null when cancelled */
export function promptDialog(title, message, defaultValue = '') {
	return open(
		`
		<h3 class="dialog__title">${escapeHtml(title)}</h3>
		<p class="dialog__body">${escapeHtml(message)}</p>
		<input class="dialog__input" data-role="input" value="${escapeHtml(defaultValue)}" spellcheck="false">
		<div class="dialog__actions">
			<button class="btn btn--text" data-role="cancel">Cancel</button>
			<button class="btn btn--filled" data-role="ok">OK</button>
		</div>`,
		() => {
			const input = dialogEl.querySelector('[data-role="input"]');
			dialogEl.querySelector('[data-role="cancel"]').onclick = () => settle(null);
			dialogEl.querySelector('[data-role="ok"]').onclick = () => settle(input.value);
			input.onkeydown = (e) => {
				if (e.key === 'Enter') settle(input.value);
			};
			setTimeout(() => input.focus(), 50);
		}
	);
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
