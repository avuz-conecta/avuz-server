/**
 * Left rail: the app menu as a column on the left (css/left-rail.css lays it
 * out from 1024px up; below that core's top header stays as it is).
 *
 * Logged-in pages only (body#body-user with the rail_collapsed initial state
 * from RailStateListener). Renders inside #header .header-start:
 * - a toggle that collapses the rail to icons (html.avuz-rail--collapsed) and
 *   saves the choice through the provisioning_api preferences endpoint
 *   (RailPreferenceValidator vouches for it). A failed save keeps the new
 *   state for this page and warns in the console. Only these toggles animate
 *   (html.avuz-rail--animated); the saved state applies on load without one.
 * - one link per app (core/apps initial state, already in the user's order),
 *   the current one with aria-current="page". Collapsed, each gets its name as
 *   a tooltip; the name stays in the link for screen readers.
 * - icons from window.AvuzIcons (js/material-icons.js, Material Symbols): an
 *   app with a glyph draws it inline, filled while it is the current app; any
 *   other app, or every app when the icon set is missing, shows its own image.
 * - "Mais aplicativos", a disclosure holding the apps that don't fit the
 *   rail's height (window.AvuzLeftRail.splitApps), recomputed on resize.
 *   Escape or a click elsewhere closes it.
 *
 * The header-end widgets (search, notifications, contacts, user menu) stay
 * core's own; the stylesheet stacks them at the rail's foot.
 */
(function leftRail() {
	'use strict';

	var LOGGED_IN_BODY_ID = 'body-user';
	var APPS_STATE_ID = 'initial-state-core-apps';
	var COLLAPSED_STATE_ID = 'initial-state-avuz_theme-rail_collapsed';
	var COLLAPSED_CLASS = 'avuz-rail--collapsed';
	var ANIMATED_CLASS = 'avuz-rail--animated';
	var RAIL_ID = 'avuz-rail';
	var OVERFLOW_ID = 'avuz-rail-overflow';
	var ITEM_HEIGHT = 44;
	var MORE_LABEL = 'Mais aplicativos';
	var RAIL_LABEL = 'Aplicativos';
	var PREFERENCE_SERVICE = 'apps/provisioning_api/api/v1/config/users/avuz_theme';
	var PREFERENCE_KEY = 'rail_collapsed';
	var OCS_VERSION = 2;
	var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
	var RAIL_CONTROL_BY_DIRECTION = { left: 'collapse', right: 'expand' };

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

	function isCollapsed() {
		return document.documentElement.classList.contains(COLLAPSED_CLASS);
	}

	function saveCollapsed(collapsed) {
		var body = new URLSearchParams();
		body.set('configValue', collapsed ? '1' : '0');
		return fetch(OC.linkToOCS(PREFERENCE_SERVICE, OCS_VERSION) + PREFERENCE_KEY, {
			method: 'POST',
			headers: {
				requesttoken: OC.requestToken,
				'OCS-APIRequest': 'true',
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body,
		}).then(function checkSaved(response) {
			if (!response.ok) {
				console.warn('[avuz_theme] left rail: could not save the collapsed state, HTTP ' + response.status);
			}
		}, function reportFailure(error) {
			console.warn('[avuz_theme] left rail: could not save the collapsed state', error);
		});
	}

	function createRail(apps) {
		var nav = document.createElement('nav');
		nav.id = RAIL_ID;
		nav.className = 'avuz-rail';
		nav.setAttribute('aria-label', RAIL_LABEL);

		var toggle = document.createElement('button');
		toggle.type = 'button';
		toggle.className = 'avuz-rail__toggle';

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

		nav.appendChild(toggle);
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

		function applyTooltips() {
			var collapsed = isCollapsed();
			nav.querySelectorAll('.avuz-rail__apps .avuz-rail__app, .avuz-rail__toggle').forEach(function setTooltip(control) {
				if (collapsed) {
					control.title = control.querySelector('.avuz-rail__label').textContent;
					return;
				}
				control.removeAttribute('title');
			});
		}

		function renderToggle() {
			var state = window.AvuzLeftRail.railToggle(isCollapsed());
			toggle.replaceChildren.apply(toggle, iconAndLabel(controlIcon(RAIL_CONTROL_BY_DIRECTION[state.direction]), state.label));
			toggle.setAttribute('aria-expanded', state.ariaExpanded);
			applyTooltips();
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
			applyTooltips();
		}

		toggle.addEventListener('click', function toggleRail() {
			var collapsed = !isCollapsed();
			document.documentElement.classList.add(ANIMATED_CLASS);
			document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsed);
			renderToggle();
			saveCollapsed(collapsed);
		});

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

		return { nav: nav, renderToggle: renderToggle, renderApps: renderApps };
	}

	function init() {
		if (document.body.id !== LOGGED_IN_BODY_ID || document.getElementById(RAIL_ID)) {
			return;
		}
		var collapsed = readState(COLLAPSED_STATE_ID);
		var headerStart = document.querySelector('#header .header-start');
		if (typeof collapsed !== 'boolean' || !headerStart || !window.AvuzLeftRail) {
			return;
		}
		var apps = readState(APPS_STATE_ID);
		document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsed);

		var rail = createRail(Array.isArray(apps) ? apps : []);
		headerStart.appendChild(rail.nav);
		rail.renderToggle();
		rail.renderApps();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}());
