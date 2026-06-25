(function () {
	'use strict';

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

	const script = document.createElement('script');
	script.src = state.url + '/assets/chat/chat-no-jquery.min.js';
	script.onload = function () {
		new window.ZammadChat({
			fontSize: '12px',
			chatId: state.chatId,
			show: false,
		});
	};
	document.body.appendChild(script);
})();
