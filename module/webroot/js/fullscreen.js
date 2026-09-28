// Fullscreen, and the layout consequence of switching it off.
//
// The manager's WebView is edge-to-edge, and not by accident: requesting
// https://mui.kernelsu.org/internal/insets.css - which tokens.css does,
// for the Material You palette's companion file - makes KernelSU enable
// edge-to-edge automatically and stop padding the WebView itself. The
// module then owns its own insets.
//
// While fullscreen was hardcoded on that cost nothing, because the system
// bars were hidden and there was nothing to pad around. It is exactly why
// no inset handling was ever needed. Switch fullscreen off and the bars
// come back, drawn OVER the page: the top bar slides under the status bar
// and the nav bar under the gesture bar.
//
// So the state is mirrored onto <html data-fullscreen> and app.css pads
// for --window-inset-top / --window-inset-bottom only while it is "off".
// Gating it that way rather than trusting the variables to go to zero is
// deliberate: if KernelSU computes them once at load instead of updating
// them when the bars hide, an ungated rule would leave a phantom gap at
// the top the moment fullscreen was turned back on.

import { fullScreen, fullScreenAvailable } from './ksu-bridge.js';

/**
 * @param {boolean} enabled
 * @returns {boolean} what was actually applied - false if the host has no
 *   fullScreen at all, so callers can correct a switch that can't be honoured.
 */
export function applyFullscreen(enabled) {
	const on = Boolean(enabled) && fullScreenAvailable();
	fullScreen(on);
	document.documentElement.dataset.fullscreen = on ? 'on' : 'off';
	return on;
}

export { fullScreenAvailable };
