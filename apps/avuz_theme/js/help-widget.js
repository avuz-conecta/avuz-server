/**
 * Subtle floating help launcher, injected into every authenticated page.
 *
 * A small, muted round button pinned bottom-right. It stays low-emphasis at
 * rest and only lifts to the brand accent on hover/focus. Hovering (desktop)
 * or tapping (touch) reveals a small card with two quiet options: the docs
 * site and a WhatsApp support link. The panel collapses on outside-click,
 * mouse-leave and Esc.
 *
 * Pure DOM enhancement: vanilla JS, no framework, no build step, no requests.
 */
(function helpWidget() {
	'use strict';

	var ROOT_ID = 'avuz-help-widget';
	var OPEN_CLASS = 'avuz-help-open';
	var DOCS_URL = 'https://ajuda.avuz.app';
	var SUPPORT_MESSAGE = 'Olá, preciso de ajuda, vim através do suporte no AvuzConecta';
	var SUPPORT_URL = 'https://wa.me/5554993370993?text=' + encodeURIComponent(SUPPORT_MESSAGE);
	var LAUNCHER_LABEL = 'Ajuda e suporte';
	var LEAVE_DELAY_MS = 200;

	var HELP_GLYPH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg>';
	var DOCS_GLYPH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';
	var SUPPORT_GLYPH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

	var leaveTimer = null;

	function alreadyInjected() {
		return !!document.getElementById(ROOT_ID);
	}

	function buildOption(href, glyph, label) {
		var link = document.createElement('a');
		link.className = 'avuz-help-option';
		link.href = href;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.innerHTML = glyph + '<span class="avuz-help-option-label"></span>';
		link.querySelector('.avuz-help-option-label').textContent = label;
		return link;
	}

	function build() {
		var root = document.createElement('div');
		root.id = ROOT_ID;

		var panel = document.createElement('div');
		panel.className = 'avuz-help-panel';
		panel.setAttribute('role', 'menu');
		panel.appendChild(buildOption(DOCS_URL, DOCS_GLYPH, 'Documentação'));
		panel.appendChild(buildOption(SUPPORT_URL, SUPPORT_GLYPH, 'Falar com o suporte'));

		var launcher = document.createElement('button');
		launcher.type = 'button';
		launcher.className = 'avuz-help-launcher';
		launcher.setAttribute('aria-label', LAUNCHER_LABEL);
		launcher.setAttribute('aria-haspopup', 'menu');
		launcher.setAttribute('aria-expanded', 'false');
		launcher.innerHTML = HELP_GLYPH;

		root.appendChild(panel);
		root.appendChild(launcher);

		return { root: root, panel: panel, launcher: launcher };
	}

	function isOpen(root) {
		return root.classList.contains(OPEN_CLASS);
	}

	function open(widget) {
		clearLeaveTimer();
		widget.root.classList.add(OPEN_CLASS);
		widget.launcher.setAttribute('aria-expanded', 'true');
	}

	function close(widget) {
		clearLeaveTimer();
		widget.root.classList.remove(OPEN_CLASS);
		widget.launcher.setAttribute('aria-expanded', 'false');
	}

	function toggle(widget) {
		if (isOpen(widget.root)) {
			close(widget);
			return;
		}
		open(widget);
	}

	function clearLeaveTimer() {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	}

	function scheduleClose(widget) {
		clearLeaveTimer();
		leaveTimer = window.setTimeout(function onLeave() {
			leaveTimer = null;
			close(widget);
		}, LEAVE_DELAY_MS);
	}

	function wire(widget) {
		widget.launcher.addEventListener('click', function onClick() {
			toggle(widget);
		});

		widget.root.addEventListener('mouseenter', function onEnter() {
			open(widget);
		});

		widget.root.addEventListener('mouseleave', function onLeave() {
			scheduleClose(widget);
		});

		widget.root.addEventListener('keydown', function onKeydown(event) {
			if (event.key !== 'Escape' && event.key !== 'Esc') {
				return;
			}
			if (!isOpen(widget.root)) {
				return;
			}
			close(widget);
			widget.launcher.focus();
		});

		document.addEventListener('click', function onDocumentClick(event) {
			if (!isOpen(widget.root)) {
				return;
			}
			if (widget.root.contains(event.target)) {
				return;
			}
			close(widget);
		});
	}

	function inject() {
		if (alreadyInjected()) {
			return;
		}
		var widget = build();
		document.body.appendChild(widget.root);
		wire(widget);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', inject);
	} else {
		inject();
	}
})();
