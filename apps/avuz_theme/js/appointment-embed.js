/**
 * Appointment booking page embedded in an iframe (e.g. the Avuz Conecta site).
 *
 * A cross-site iframe gets no session cookies, so the calendar's slots/book
 * requests fail the CSRF check (412). The server accepts the `OCS-APIRequest`
 * header as CSRF proof, so this adds it to those two requests (harmless when
 * the page is not framed). After a booking request succeeds it posts
 * {type, start, end, timeZone} to the embedding page, only when that page's
 * origin is in the allowlist (initial state from AppointmentEmbedStateListener)
 * and only to that exact origin. Never visitor data (name, email, description).
 *
 * Embed mode (?embed=1, framed by an allowlisted origin) marks <html> with
 * `avuz-embed`, which turns on css/appointment-embed.css: the page renders as
 * a bare widget. <html> always gets `avuz-embed-checked` once the check ran,
 * which lifts the pre-hide (css/appointment-embed-prehide.css) either way.
 * In embed mode it also posts {type: 'avuz:resize', height} to the same
 * origin on load and whenever the content changes size, once the layout has
 * settled (RESIZE_SETTLE_MS after the last change), so transient heights
 * between two steps never reach the site. The height is the booking UI
 * wrapper (#content, the server-rendered element around the whole calendar
 * app; document.body as fallback), not the viewport, so the site can both grow
 * and shrink the iframe.
 *
 * The time zone picker (vue-select) appends its options list to <body> and
 * positions it with floating-ui, which flips it upward and clips it inside a
 * content-sized frame. In embed mode the list is moved back next to its toggle,
 * where css/appointment-embed.css lays it out in the page flow: it opens
 * downward, at full width, and grows #content (and so the iframe) while open.
 *
 * A booked appointment stays pending until the visitor confirms it by email.
 */
(function appointmentEmbed() {
	'use strict';

	var APPOINTMENT_PAGE_PATTERN = /^(?:\/index\.php)?\/apps\/calendar\/appointment\/[A-Za-z0-9]+\/?$/;
	var BOOKING_REQUEST_PATTERN = /^(?:\/index\.php)?\/apps\/calendar\/appointment\/[A-Za-z0-9]+\/(slots|book)$/;
	var BOOK_ACTION = 'book';
	var ORIGINS_STATE_ID = 'initial-state-avuz_theme-embedAllowedOrigins';
	var MESSAGE_TYPE = 'avuz:appointment-booked';
	var RESIZE_MESSAGE_TYPE = 'avuz:resize';
	var EMBED_PARAM = 'embed';
	var EMBED_PARAM_VALUE = '1';
	var EMBED_CLASS = 'avuz-embed';
	var EMBED_CHECKED_CLASS = 'avuz-embed-checked';
	var CONTENT_WRAPPER_ID = 'content';
	var TIME_ZONE_PICKER_SELECTOR = '.booking__time-zone';
	var COMBOBOX_SELECTOR = '[aria-controls]';
	var DROPDOWN_TOGGLE_SELECTOR = '.vs__dropdown-toggle';
	var DROPDOWN_MENU_CLASS = 'vs__dropdown-menu';
	var CSRF_HEADER = 'OCS-APIRequest';
	var CSRF_HEADER_VALUE = 'true';
	var HTTP_OK = 200;
	var RESIZE_SETTLE_MS = 100;
	// The booking page requests today's slots as soon as it mounts.
	var NO_MATCH_WARNING_DELAY_MS = 15000;

	if (!APPOINTMENT_PAGE_PATTERN.test(window.location.pathname)) {
		return;
	}

	var allowedOrigins = null;
	var matchedBookingRequest = false;
	var xhrBookingActions = new WeakMap();
	var contentWrapper = null;
	var lastSentHeight = null;
	var heightTimer = null;

	// Decide before anything else, so the pre-hide lifts even if a later step throws.
	var embedMode = applyEmbedMode();

	function readAllowedOrigins() {
		var stateElement = document.getElementById(ORIGINS_STATE_ID);
		if (!stateElement) {
			return [];
		}
		try {
			var origins = JSON.parse(atob(stateElement.value));
			return Array.isArray(origins) ? origins.filter(function isString(origin) {
				return typeof origin === 'string';
			}) : [];
		} catch (error) {
			return [];
		}
	}

	function bookingAction(url) {
		if (!url) {
			return null;
		}
		try {
			var parsed = new URL(String(url), window.location.href);
			if (parsed.origin !== window.location.origin) {
				return null;
			}
			var match = BOOKING_REQUEST_PATTERN.exec(parsed.pathname);
			return match ? match[1] : null;
		} catch (error) {
			return null;
		}
	}

	function bookedMessage(body) {
		if (typeof body !== 'string') {
			return null;
		}
		try {
			var booking = JSON.parse(body);
			if (!booking || typeof booking.start !== 'number' || typeof booking.end !== 'number' || typeof booking.timeZone !== 'string') {
				return null;
			}
			return { type: MESSAGE_TYPE, start: booking.start, end: booking.end, timeZone: booking.timeZone };
		} catch (error) {
			return null;
		}
	}

	function embedderOrigin() {
		var ancestorOrigins = window.location.ancestorOrigins;
		if (ancestorOrigins && ancestorOrigins.length > 0) {
			return ancestorOrigins[0];
		}
		if (!document.referrer) {
			return null;
		}
		try {
			return new URL(document.referrer).origin;
		} catch (error) {
			return null;
		}
	}

	function allowedEmbedderOrigin() {
		if (window.parent === window) {
			return null;
		}
		if (allowedOrigins === null) {
			allowedOrigins = readAllowedOrigins();
		}
		var origin = embedderOrigin();
		return origin && allowedOrigins.indexOf(origin) !== -1 ? origin : null;
	}

	function notifyEmbedder(message) {
		if (!message) {
			return;
		}
		var origin = allowedEmbedderOrigin();
		if (!origin) {
			return;
		}
		window.parent.postMessage(message, origin);
	}

	function isEmbedRequested() {
		return new URLSearchParams(window.location.search).get(EMBED_PARAM) === EMBED_PARAM_VALUE;
	}

	function applyEmbedMode() {
		var root = document.documentElement;
		var active = isEmbedRequested() && allowedEmbedderOrigin() !== null;
		if (active) {
			root.classList.add(EMBED_CLASS);
		}
		root.classList.add(EMBED_CHECKED_CLASS);
		return active;
	}

	function contentHeight() {
		return contentWrapper ? Math.ceil(contentWrapper.getBoundingClientRect().height) : 0;
	}

	function sendHeight() {
		var height = contentHeight();
		if (height <= 0 || height === lastSentHeight) {
			return;
		}
		lastSentHeight = height;
		notifyEmbedder({ type: RESIZE_MESSAGE_TYPE, height: height });
	}

	function measureHeight() {
		window.requestAnimationFrame(sendHeight);
	}

	function scheduleHeight() {
		window.clearTimeout(heightTimer);
		heightTimer = window.setTimeout(measureHeight, RESIZE_SETTLE_MS);
	}

	function watchHeight() {
		contentWrapper = document.getElementById(CONTENT_WRAPPER_ID) || document.body;
		scheduleHeight();
		window.addEventListener('resize', scheduleHeight);
		window.addEventListener('load', scheduleHeight);
		if (typeof window.ResizeObserver !== 'function') {
			return;
		}
		if (contentWrapper) {
			new window.ResizeObserver(scheduleHeight).observe(contentWrapper);
		}
	}

	function timeZoneToggleOwning(menu) {
		var picker = document.querySelector(TIME_ZONE_PICKER_SELECTOR);
		var combobox = picker ? picker.querySelector(COMBOBOX_SELECTOR) : null;
		if (!combobox || !menu.id || combobox.getAttribute('aria-controls') !== menu.id) {
			return null;
		}
		return picker.querySelector(DROPDOWN_TOGGLE_SELECTOR);
	}

	function moveTimeZoneMenu(node) {
		if (!node.classList || !node.classList.contains(DROPDOWN_MENU_CLASS)) {
			return;
		}
		var toggle = timeZoneToggleOwning(node);
		if (toggle) {
			toggle.insertAdjacentElement('afterend', node);
		}
	}

	function moveTimeZoneMenus(mutations) {
		mutations.forEach(function moveAddedMenus(mutation) {
			Array.prototype.forEach.call(mutation.addedNodes, moveTimeZoneMenu);
		});
	}

	function watchTimeZoneMenu() {
		if (typeof window.MutationObserver !== 'function' || !document.body) {
			return;
		}
		new window.MutationObserver(moveTimeZoneMenus).observe(document.body, { childList: true });
	}

	function startEmbedWatchers() {
		watchHeight();
		watchTimeZoneMenu();
	}

	var originalOpen = XMLHttpRequest.prototype.open;
	var originalSend = XMLHttpRequest.prototype.send;

	XMLHttpRequest.prototype.open = function open(method, url) {
		xhrBookingActions.set(this, bookingAction(url));
		return originalOpen.apply(this, arguments);
	};

	XMLHttpRequest.prototype.send = function send(body) {
		var action = xhrBookingActions.get(this);
		if (!action) {
			return originalSend.apply(this, arguments);
		}
		matchedBookingRequest = true;
		this.setRequestHeader(CSRF_HEADER, CSRF_HEADER_VALUE);
		if (action === BOOK_ACTION) {
			var message = bookedMessage(body);
			this.addEventListener('load', function onBookLoad() {
				if (this.status === HTTP_OK) {
					notifyEmbedder(message);
				}
			});
		}
		return originalSend.apply(this, arguments);
	};

	if (typeof window.fetch === 'function') {
		var originalFetch = window.fetch;
		window.fetch = async function fetch(input, init) {
			var action = bookingAction(input instanceof Request ? input.url : input);
			if (!action) {
				return originalFetch.apply(this, arguments);
			}
			matchedBookingRequest = true;
			var request = new Request(input, init);
			request.headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
			var body = action === BOOK_ACTION ? await request.clone().text() : null;
			var response = await originalFetch.call(this, request);
			if (action === BOOK_ACTION && response.status === HTTP_OK) {
				notifyEmbedder(bookedMessage(body));
			}
			return response;
		};
	}

	function startEmbedMode() {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', startEmbedWatchers);
			return;
		}
		startEmbedWatchers();
	}

	if (embedMode) {
		startEmbedMode();
	}

	window.setTimeout(function warnWhenNothingMatched() {
		if (!matchedBookingRequest) {
			console.warn('[avuz] appointment-embed: no calendar slots/book request intercepted; the calendar may have changed how it calls them, so booking inside an iframe will fail (412).');
		}
	}, NO_MATCH_WARNING_DELAY_MS);
})();
