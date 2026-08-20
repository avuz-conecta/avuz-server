(function () {
	'use strict';

	function buildIdentityLine(s) {
		const name = (s.userName || 'Usuário').trim();
		const login = (s.userLogin || '').trim();
		const email = (s.userEmail || '').trim();
		const org = (s.org || '').trim();
		const parts = [name];
		if (login && email) {
			if (login === email) {
				parts.push(email);
			} else {
				parts.push(login);
				parts.push(email);
			}
		} else if (login || email) {
			parts.push(login || email);
		}
		let line = (login || email)
			? '👤 ' + parts.join(' · ')
			: '👤 ' + name + ' (sem e-mail cadastrado)';
		if (org) {
			line += ' · ' + org;
		}
		return line;
	}
	window.__avuzBuildIdentityLine = buildIdentityLine;

	const state = OCP.InitialState.loadState('avuz_theme', 'zammad');
	if (!state || !state.url || !state.chatId) {
		return; // guarded: misconfig must not throw
	}

	// The no-jQuery build auto-binds to any element with class `open-zammad-chat`.
	// We provide our own branded launcher; show:false keeps it closed until clicked.
	const button = document.createElement('div');
	button.className = 'open-zammad-chat avuz-zammad-launcher';
	button.setAttribute('role', 'button');
	button.setAttribute('tabindex', '0');
	button.setAttribute('aria-label', 'Abrir suporte');
	button.textContent = 'Suporte';
	Object.assign(button.style, {
		position: 'fixed',
		right: '20px',
		bottom: '20px',
		zIndex: '1000',
		background: '#2bb5e3',
		color: '#fff',
		padding: '10px 16px',
		borderRadius: '20px',
		cursor: 'pointer',
		fontSize: '14px',
		boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
	});
	document.body.appendChild(button);

	// Shared between the launcher observer (which re-arms per conversation) and the
	// send wrap (which guards one identity line per conversation).
	let identitySent = false;
	let panelWasOpen = false;

	// The lib never hides our custom launcher when the panel opens, so it overlaps
	// the chat's input row (looks like the panel is cut off at the bottom). Toggle
	// the launcher off the panel's own open-state class. Also re-arm the identity
	// line on each closed→open transition, so every new conversation carries it —
	// not just the first one per page load.
	const syncLauncher = function () {
		const panel = document.querySelector('.zammad-chat');
		const isOpen = !!(panel && panel.classList.contains('zammad-chat-is-open'));
		button.style.display = isOpen ? 'none' : '';
		if (isOpen && !panelWasOpen) {
			identitySent = false;
		}
		panelWasOpen = isOpen;
	};
	new MutationObserver(syncLauncher).observe(document.body, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['class'],
	});

	// Zammad's lib auto-loads chat.css through a `data:text/css` @import, which our
	// CSP style-src (domain-only) rejects — leaving the widget unstyled and, with
	// cssAutoload on, never reaching `onReady`. Load the stylesheet ourselves via a
	// normal <link> (allowed by the style-src domain) and disable the lib's loader.
	const stylesheet = document.createElement('link');
	stylesheet.rel = 'stylesheet';
	stylesheet.href = state.url + '/assets/chat/chat.css';
	document.head.appendChild(stylesheet);

	const script = document.createElement('script');
	script.src = state.url + '/assets/chat/chat-no-jquery.min.js';
	script.onload = function () {
		const zammadChat = new window.ZammadChat({
			fontSize: '12px',
			chatId: state.chatId,
			cssAutoload: false,
			show: false,
		});

		// Send the identity line as the FIRST message (not on open — that would
		// queue ghost sessions from users who just peek). The widget's input is a
		// contenteditable <div> whose innerHTML the lib sends, so set the element's
		// text content (auto-escaped), not `.value`. Wrap sendMessage so the first
		// user message is preceded by one identity line, once per session.
		const originalSend = zammadChat.sendMessage.bind(zammadChat);
		zammadChat.sendMessage = function () {
			if (!identitySent) {
				identitySent = true;
				const input = document.querySelector('.zammad-chat-input');
				if (input) {
					const pending = input.innerHTML;
					input.textContent = buildIdentityLine(state);
					originalSend();
					input.innerHTML = pending;
				}
			}
			return originalSend();
		};
	};
	document.body.appendChild(script);
})();
