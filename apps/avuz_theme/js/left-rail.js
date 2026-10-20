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
 *   Below 1280px the rail starts collapsed whatever was saved; a toggle there
 *   only lasts the browser session (sessionStorage) and is never saved.
 *   Crossing 1280px re-applies the rule (window.AvuzLeftRail.effectiveCollapsed).
 * - one link per app (core/apps initial state, already in the user's order),
 *   the current one with aria-current="page". Collapsed, each gets its name as
 *   a tooltip; the name stays in the link for screen readers.
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
	var NARROW_QUERY = '(max-width: 1279px)';
	var SESSION_CHOICE_KEY = 'avuz_theme.rail.narrowChoice';
	var MORE_LABEL = 'Mais aplicativos';
	var RAIL_LABEL = 'Aplicativos';
	var PREFERENCE_SERVICE = 'apps/provisioning_api/api/v1/config/users/avuz_theme';
	var PREFERENCE_KEY = 'rail_collapsed';
	var OCS_VERSION = 2;
	var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
	var ICON_PATHS = {
		left: ['m11 17-5-5 5-5', 'm18 17-5-5 5-5'],
		right: ['m6 17 5-5-5-5', 'm13 17 5-5-5-5'],
		more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
	};

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

	function icon(name) {
		var svg = document.createElementNS(SVG_NAMESPACE, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '20');
		svg.setAttribute('height', '20');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', 'avuz-rail__icon');
		ICON_PATHS[name].forEach(function addPath(definition) {
			var path = document.createElementNS(SVG_NAMESPACE, 'path');
			path.setAttribute('d', definition);
			svg.appendChild(path);
		});
		return svg;
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
		var image = document.createElement('img');
		image.className = 'avuz-rail__icon';
		image.src = app.icon;
		image.alt = '';
		link.appendChild(image);
		link.appendChild(label(app.name));
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

	function narrowMedia() {
		return typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null;
	}

	// sessionStorage can be missing or throw (private mode, blocked storage)
	function readSessionChoice() {
		try {
			return window.sessionStorage.getItem(SESSION_CHOICE_KEY);
		} catch (error) {
			return null;
		}
	}

	function writeSessionChoice(choice) {
		try {
			window.sessionStorage.setItem(SESSION_CHOICE_KEY, choice);
		} catch (error) {
			console.warn('[avuz_theme] left rail: could not remember the choice for this session', error);
		}
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

	function createRail(apps, preferences) {
		var media = narrowMedia();
		var choices = window.AvuzLeftRail.SESSION_CHOICES;
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
		moreButton.appendChild(icon('more'));
		moreButton.appendChild(label(MORE_LABEL));

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
			toggle.replaceChildren(icon(state.direction), label(state.label));
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

		function isNarrow() {
			return media !== null && media.matches;
		}

		function applyCollapsed() {
			var collapsed = window.AvuzLeftRail.effectiveCollapsed({
				saved: preferences.saved,
				narrow: isNarrow(),
				sessionChoice: readSessionChoice(),
			});
			document.documentElement.classList.toggle(COLLAPSED_CLASS, collapsed);
			renderToggle();
		}

		toggle.addEventListener('click', function toggleRail() {
			var collapsed = !isCollapsed();
			document.documentElement.classList.add(ANIMATED_CLASS);
			if (isNarrow()) {
				writeSessionChoice(collapsed ? choices.collapsed : choices.expanded);
			} else {
				preferences.saved = collapsed;
				saveCollapsed(collapsed);
			}
			applyCollapsed();
		});

		if (media !== null) {
			media.addEventListener('change', applyCollapsed);
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

		return { nav: nav, applyCollapsed: applyCollapsed, renderApps: renderApps };
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

		var rail = createRail(Array.isArray(apps) ? apps : [], { saved: collapsed });
		headerStart.appendChild(rail.nav);
		rail.applyCollapsed();
		rail.renderApps();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
		return;
	}
	init();
}());
