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
 * A booked appointment stays pending until the visitor confirms it by email.
 */
(function appointmentEmbed() {
	'use strict';

	var APPOINTMENT_PAGE_PATTERN = /^(?:\/index\.php)?\/apps\/calendar\/appointment\/[A-Za-z0-9]+\/?$/;
	var BOOKING_REQUEST_PATTERN = /^(?:\/index\.php)?\/apps\/calendar\/appointment\/[A-Za-z0-9]+\/(slots|book)$/;
	var BOOK_ACTION = 'book';
	var ORIGINS_STATE_ID = 'initial-state-avuz_theme-embedAllowedOrigins';
	var MESSAGE_TYPE = 'avuz:appointment-booked';
	var CSRF_HEADER = 'OCS-APIRequest';
	var CSRF_HEADER_VALUE = 'true';
	var HTTP_OK = 200;
	// The booking page requests today's slots as soon as it mounts.
	var NO_MATCH_WARNING_DELAY_MS = 15000;

	if (!APPOINTMENT_PAGE_PATTERN.test(window.location.pathname)) {
		return;
	}

	var allowedOrigins = null;
	var matchedBookingRequest = false;
	var xhrBookingActions = new WeakMap();

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

	function notifyEmbedder(message) {
		if (!message || window.parent === window) {
			return;
		}
		if (allowedOrigins === null) {
			allowedOrigins = readAllowedOrigins();
		}
		var origin = embedderOrigin();
		if (!origin || allowedOrigins.indexOf(origin) === -1) {
			return;
		}
		window.parent.postMessage(message, origin);
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

	window.setTimeout(function warnWhenNothingMatched() {
		if (!matchedBookingRequest) {
			console.warn('[avuz] appointment-embed: no calendar slots/book request intercepted; the calendar may have changed how it calls them, so booking inside an iframe will fail (412).');
		}
	}, NO_MATCH_WARNING_DELAY_MS);
})();
