/**
 * Left rail: the app menu as a column on the left (css/left-rail.css lays it
 * out from 1024px up; below that core's top header stays as it is).
 *
 * Logged-in pages only (body#body-user, or body#body-settings on settings,
 * admin and help pages). Always expanded: icon and name for every app.
 * Renders inside #header .header-start:
 * - one link per app (core/apps initial state, already in the user's order),
 *   the current one with aria-current="page".
 * - icons from window.AvuzIcons (js/material-icons.js, Material Symbols): an
 *   app with a glyph draws it inline, filled while it is the current app; any
 *   other app, or every app when the icon set is missing, shows its own image.
 * - "Mais aplicativos", a disclosure holding the apps that don't fit the
 *   rail's height (window.AvuzLeftRail.splitApps), recomputed on resize.
 *   Escape or a click elsewhere closes it.
 *
 * The header-end widgets (search, notifications, contacts, user menu) stay
 * core's own; the stylesheet stacks them at the rail's foot. Search and
 * notifications get Material glyphs too: this script hands them to the
 * stylesheet as mask images (--avuz-rail-icon-*) and marks the page with
 * html.avuz-rail--material-foot, so core's icons stay if the set is missing.
 */
(function leftRail() {
	'use strict';

	var LOGGED_IN_BODY_IDS = ['body-user', 'body-settings'];
	var APPS_STATE_ID = 'initial-state-core-apps';
	var RAIL_ID = 'avuz-rail';
	var OVERFLOW_ID = 'avuz-rail-overflow';
	var ITEM_HEIGHT = 44;
	var MORE_LABEL = 'Mais aplicativos';
	var RAIL_LABEL = 'Aplicativos';
	var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
	var FOOT_ICONS_CLASS = 'avuz-rail--material-foot';
	var FOOT_CONTROLS = ['search', 'notifications'];

	function readState(elementId) {
		var stateElement = document.getElementById(elementId);
		if (!stateElement) {
			return undefined;
		}
		try {
			var bytes = Uint8Array.from(atob(stateElement.value), function toByte(character) { return character.charCodeAt(0); });
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch (error) {
			return undefined;
		}
	}

	function ownEntry(map, key) {
		return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
	}

	function glyphIcon(name, filled) {
		var icons = window.AvuzIcons;
		var glyph = icons && name ? ownEntry(icons.glyphs, name) : undefined;
		if (!glyph) {
			return null;
		}
		var svg = document.createElementNS(SVG_NAMESPACE, 'svg');
		svg.setAttribute('viewBox', icons.viewBox);
		svg.setAttribute('fill', 'currentColor');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', 'avuz-rail__icon');
		var path = document.createElementNS(SVG_NAMESPACE, 'path');
		path.setAttribute('d', filled ? glyph.fill : glyph.regular);
		svg.appendChild(path);
		return svg;
	}

	function controlIcon(control) {
		return window.AvuzIcons ? glyphIcon(ownEntry(window.AvuzIcons.rail, control), false) : null;
	}

	function appIcon(app) {
		var glyphName = window.AvuzIcons ? ownEntry(window.AvuzIcons.apps, app.id) : undefined;
		var glyph = glyphIcon(glyphName, app.active);
		if (glyph) {
			return glyph;
		}
		var image = document.createElement('img');
		image.className = 'avuz-rail__icon';
		image.src = app.icon;
		image.alt = '';
		return image;
	}

	function maskImage(glyphName) {
		var icons = window.AvuzIcons;
		var svg = '<svg xmlns="' + SVG_NAMESPACE + '" viewBox="' + icons.viewBox + '"><path d="' + icons.glyphs[glyphName].regular + '"/></svg>';
		return 'url("data:image/svg+xml;base64,' + btoa(svg) + '")';
	}

	function applyFootIcons() {
		if (!window.AvuzIcons) {
			return;
		}
		var root = document.documentElement;
		FOOT_CONTROLS.forEach(function setMask(control) {
			root.style.setProperty('--avuz-rail-icon-' + control, maskImage(window.AvuzIcons.rail[control]));
		});
		root.classList.add(FOOT_ICONS_CLASS);
	}

	function iconAndLabel(iconElement, text) {
		return [iconElement, label(text)].filter(Boolean);
	}

	function label(text) {
		var span = document.createElement('span');
		span.className = 'avuz-rail__label';
		span.textContent = text;
		return span;
	}

	function appLink(app) {
		var link = document.createElement('a');
		link.className = 'avuz-rail__app';
		link.href = app.href;
		if (app.active) {
			link.setAttribute('aria-current', 'page');
		}
		link.append.apply(link, iconAndLabel(appIcon(app), app.name));
		return link;
	}

	function listItem(child) {
		var item = document.createElement('li');
		item.appendChild(child);
		return item;
	}

	function createRail(apps) {
		var nav = document.createElement('nav');
		nav.id = RAIL_ID;
		nav.className = 'avuz-rail';
		nav.setAttribute('aria-label', RAIL_LABEL);

		var appList = document.createElement('ul');
		appList.className = 'avuz-rail__apps';

		var moreButton = document.createElement('button');
		moreButton.type = 'button';
		moreButton.className = 'avuz-rail__app avuz-rail__more';
		moreButton.setAttribute('aria-expanded', 'false');
		moreButton.setAttribute('aria-controls', OVERFLOW_ID);
		moreButton.append.apply(moreButton, iconAndLabel(controlIcon('more'), MORE_LABEL));

		var overflowList = document.createElement('ul');
		overflowList.id = OVERFLOW_ID;
		overflowList.className = 'avuz-rail__overflow';
		overflowList.hidden = true;

		nav.appendChild(appList);
		nav.appendChild(overflowList);

		function isOverflowOpen() {
			return moreButton.getAttribute('aria-expanded') === 'true';
		}

		function closeOverflow(returnFocus) {
			if (!isOverflowOpen()) {
				return;
			}
			moreButton.setAttribute('aria-expanded', 'false');
			overflowList.hidden = true;
			if (returnFocus) {
				moreButton.focus();
			}
		}

		function openOverflow() {
			moreButton.setAttribute('aria-expanded', 'true');
			overflowList.hidden = false;
			var firstLink = overflowList.querySelector('a');
			if (firstLink) {
				firstLink.focus();
			}
		}

		function renderApps() {
			closeOverflow(false);
			var split = window.AvuzLeftRail.splitApps(apps, appList.clientHeight, ITEM_HEIGHT);
			var items = split.visible.map(function toItem(app) { return listItem(appLink(app)); });
			if (split.overflow.length > 0) {
				items.push(listItem(moreButton));
			}
			appList.replaceChildren.apply(appList, items);
			overflowList.replaceChildren.apply(overflowList, split.overflow.map(function toItem(app) { return listItem(appLink(app)); }));
		}

		moreButton.addEventListener('click', function toggleOverflow() {
			if (isOverflowOpen()) {
				closeOverflow(false);
				return;
			}
			openOverflow();
		});

		document.addEventListener('keydown', function closeOnEscape(event) {
			if (event.key !== 'Escape' || !isOverflowOpen()) {
				return;
			}
			closeOverflow(true);
		});

		document.addEventListener('click', function closeOnOutsideClick(event) {
			if (!isOverflowOpen() || moreButton.contains(event.target) || overflowList.contains(event.target)) {
				return;
			}
			closeOverflow(false);
		});

		var framePending = false;
		var renderedHeight = -1;
		function scheduleRender() {
			if (framePending) {
				return;
			}
			framePending = true;
			window.requestAnimationFrame(function renderOnFrame() {
				framePending = false;
				if (appList.clientHeight === renderedHeight) {
					return;
				}
				renderedHeight = appList.clientHeight;
				renderApps();
			});
		}
		// The list's height settles after styles and fonts load, and changes with the window
		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(scheduleRender).observe(appList);
		}
		window.addEventListener('resize', scheduleRender);

		return { nav: nav, renderApps: renderApps };
	}

	function init() {
		if (!LOGGED_IN_BODY_IDS.includes(document.body.id) || document.getElementById(RAIL_ID)) {
			return;
		}
		var headerStart = document.querySelector('#header .header-start');
		if (!headerStart || !window.AvuzLeftRail) {
			return;
		}
		var apps = readState(APPS_STATE_ID);

		var rail = createRail(Array.isArray(apps) ? apps : []);
		headerStart.appendChild(rail.nav);
		rail.renderApps();
		applyFootIcons();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}());
