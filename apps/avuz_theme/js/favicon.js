/**
 * Browser tab icon: the current app's Material Symbols glyph (window.AvuzIcons,
 * js/material-icons.js) in Avuz blue, kept in step with SPA navigation.
 * Pages outside a known app keep the server's favicon, except the start page,
 * which shows the dashboard's.
 */
(function favicon() {
	'use strict';

	var FAVICON_COLOR = '#2bb5e3';
	var FAVICON_SIZE = 32;
	var START_APP = 'dashboard';

	function currentApp(pathname) {
		var apps = Object.keys(window.AvuzIcons.apps);
		var match = apps.find(function isOpen(appId) { return pathname.includes('/apps/' + appId); });
		if (match) {
			return match;
		}
		if (pathname === '/' || pathname.includes('/index.php')) {
			return START_APP;
		}
		return undefined;
	}

	function faviconUrl(glyphName) {
		var icons = window.AvuzIcons;
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + FAVICON_SIZE + '" height="' + FAVICON_SIZE + '" viewBox="' + icons.viewBox + '" fill="' + FAVICON_COLOR + '">'
			+ '<path d="' + icons.glyphs[glyphName].regular + '"/></svg>';
		return 'data:image/svg+xml;base64,' + btoa(svg);
	}

	function updateFavicon() {
		var appId = currentApp(window.location.pathname);
		if (!appId) {
			return;
		}
		var href = faviconUrl(window.AvuzIcons.apps[appId]);
		document.querySelectorAll('link[rel*="icon"]').forEach(function setIcon(link) {
			link.href = href;
		});
	}

	function updateAfter(historyMethod) {
		var original = history[historyMethod];
		history[historyMethod] = function navigate() {
			var result = original.apply(this, arguments);
			updateFavicon();
			return result;
		};
	}

	if (!window.AvuzIcons) {
		return;
	}
	updateFavicon();
	window.addEventListener('popstate', updateFavicon);
	updateAfter('pushState');
	updateAfter('replaceState');
}());
