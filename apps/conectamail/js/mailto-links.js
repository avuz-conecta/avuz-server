/**
 * E-mail links anywhere in Avuz Conecta (Contatos, Agenda, perfis, Tarefas) open a new
 * ConectaMail message in a new tab instead of the computer's own mail program.
 * Loaded only for users whose ConectaMail is the webmail and who have a mailbox
 * (lib/Listener/MailtoLinksListener.php); everyone else keeps the browser's mailto.
 */
(function () {
	'use strict';

	var COMPOSE_PATH = '/apps/conectamail/compose';

	function composeUrl() {
		if (window.OC && typeof window.OC.generateUrl === 'function') {
			return window.OC.generateUrl(COMPOSE_PATH);
		}
		return '/index.php' + COMPOSE_PATH;
	}

	/** "mailto:a@x.com,b@y.com?subject=..." → "a@x.com,b@y.com" ('' when it names nobody) */
	function recipientsOf(href) {
		var addresses = href.slice('mailto:'.length).split('?')[0];
		try {
			return decodeURIComponent(addresses).trim();
		} catch (error) {
			return addresses.trim();
		}
	}

	function isPlainClick(event) {
		return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
	}

	document.addEventListener('click', function (event) {
		if (event.defaultPrevented || !isPlainClick(event) || !(event.target instanceof Element)) {
			return;
		}
		var link = event.target.closest('a[href]');
		var href = link ? link.getAttribute('href') : '';
		if (!href || href.slice(0, 7).toLowerCase() !== 'mailto:') {
			return;
		}
		var recipients = recipientsOf(href);
		if (!recipients) {
			return;
		}
		event.preventDefault();
		window.open(composeUrl() + '?to=' + encodeURIComponent(recipients), '_blank', 'noopener');
	});
})();
