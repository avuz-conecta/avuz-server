import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/appointment-embed.js', import.meta.url)), 'utf8');
const SITE_ORIGIN = 'https://avuzconecta.com.br';
const OTHER_ORIGIN = 'https://evil.example';
const BOOKING_PATH = '/apps/calendar/appointment/abc123';
const BOOK_URL = `${BOOKING_PATH}/book`;
const EMBED_QUERY = '?embed=1';
const HTTP_OK = 200;
const PAGE_HEIGHT = 3000;

function encodeOrigins(origins) {
	return Buffer.from(JSON.stringify(origins)).toString('base64');
}

class FakeClassList {
	constructor() {
		this.names = new Set();
	}

	add(...names) {
		names.forEach((name) => this.names.add(name));
	}

	contains(name) {
		return this.names.has(name);
	}
}

function fakeElement(height) {
	return {
		height,
		scrollHeight: PAGE_HEIGHT,
		classList: new FakeClassList(),
		getBoundingClientRect() {
			return { height: this.height };
		},
	};
}

/**
 * Runs js/appointment-embed.js on a fake booking page.
 * `ancestorOrigins: null` models browsers without location.ancestorOrigins (Firefox),
 * which fall back to document.referrer.
 */
function loadBookingPage({
	embedded = true,
	search = EMBED_QUERY,
	ancestorOrigins = [SITE_ORIGIN],
	referrer = '',
	allowedOrigins = [SITE_ORIGIN],
	height = 900,
	hasContentWrapper = true,
	readyState = 'complete',
} = {}) {
	const posted = [];
	const frameCallbacks = [];
	const windowListeners = {};
	const documentListeners = {};
	const observers = [];
	const documentElement = fakeElement(PAGE_HEIGHT);
	const body = fakeElement(height);
	const contentWrapper = hasContentWrapper ? fakeElement(height) : null;
	const measured = contentWrapper ?? body;
	const stateElement = allowedOrigins.length > 0 ? { value: encodeOrigins(allowedOrigins) } : null;
	const elementsById = {
		'initial-state-avuz_theme-embedAllowedOrigins': stateElement,
		content: contentWrapper,
	};

	class FakeResizeObserver {
		constructor(callback) {
			this.callback = callback;
			this.targets = [];
			observers.push(this);
		}

		observe(target) {
			this.targets.push(target);
		}
	}

	class FakeXMLHttpRequest {
		constructor() {
			this.listeners = {};
			this.status = 0;
		}

		open() {}

		send() {}

		setRequestHeader() {}

		addEventListener(type, listener) {
			this.listeners[type] = listener;
		}
	}

	const context = {
		URL,
		URLSearchParams,
		WeakMap,
		JSON,
		Math,
		atob,
		console,
		XMLHttpRequest: FakeXMLHttpRequest,
		ResizeObserver: FakeResizeObserver,
		setTimeout: () => 0,
		requestAnimationFrame: (callback) => frameCallbacks.push(callback),
		addEventListener: (type, listener) => {
			windowListeners[type] = listener;
		},
		location: {
			pathname: BOOKING_PATH,
			search,
			href: `https://cloud.example${BOOKING_PATH}${search}`,
			origin: 'https://cloud.example',
			...(ancestorOrigins === null ? {} : { ancestorOrigins: embedded ? ancestorOrigins : [] }),
		},
		document: {
			readyState,
			referrer,
			documentElement,
			body,
			getElementById: (id) => elementsById[id] ?? null,
			addEventListener: (type, listener) => {
				documentListeners[type] = listener;
			},
		},
	};
	context.window = context;
	context.parent = embedded
		? { postMessage: (message, targetOrigin) => posted.push({ message: structuredClone(message), targetOrigin }) }
		: context;

	vm.createContext(context);
	vm.runInContext(SCRIPT, context);

	return {
		posted,
		observers,
		windowListeners,
		documentListeners,
		rootClasses: documentElement.classList,
		measured,
		setHeight(newHeight) {
			measured.height = newHeight;
		},
		notifyObservers() {
			observers.forEach((observer) => observer.callback());
		},
		flushFrames() {
			frameCallbacks.splice(0).forEach((callback) => callback());
		},
		book(body) {
			const request = new context.XMLHttpRequest();
			request.open('POST', BOOK_URL);
			request.send(JSON.stringify(body));
			request.status = HTTP_OK;
			request.listeners.load.call(request);
		},
	};
}

function resizeMessages(posted) {
	return posted.filter(({ message }) => message.type === 'avuz:resize');
}

function sentHeights(page) {
	return resizeMessages(page.posted).map(({ message }) => message.height);
}

function bookedMessages(posted) {
	return posted.filter(({ message }) => message.type === 'avuz:appointment-booked');
}

describe('appointment-embed', () => {
	describe('embed mode gate', () => {
		describe('when embed=1, framed and the parent origin is allowlisted', () => {
			it('turns embed mode on', () => {
				const page = loadBookingPage();

				assert.equal(page.rootClasses.contains('avuz-embed'), true);
			});

			it('lifts the pre-hide', () => {
				const page = loadBookingPage();

				assert.equal(page.rootClasses.contains('avuz-embed-checked'), true);
			});

			it('accepts embed=1 among other query parameters', () => {
				const page = loadBookingPage({ search: '?utm_source=site&embed=1' });

				assert.equal(page.rootClasses.contains('avuz-embed'), true);
			});
		});

		describe('without embed=1', () => {
			for (const search of ['', '?embed=0', '?embed=true', '?embed']) {
				it(`stays off for "${search}" and still lifts the pre-hide`, () => {
					const page = loadBookingPage({ search });

					assert.equal(page.rootClasses.contains('avuz-embed'), false);
					assert.equal(page.rootClasses.contains('avuz-embed-checked'), true);
				});
			}
		});

		describe('when not framed', () => {
			it('stays off and still lifts the pre-hide', () => {
				const page = loadBookingPage({ embedded: false });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
				assert.equal(page.rootClasses.contains('avuz-embed-checked'), true);
			});
		});

		describe('when the allowlist is empty', () => {
			it('stays off', () => {
				const page = loadBookingPage({ allowedOrigins: [] });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
			});
		});

		describe('with location.ancestorOrigins', () => {
			it('stays off when the parent origin is not allowlisted', () => {
				const page = loadBookingPage({ ancestorOrigins: [OTHER_ORIGIN], referrer: `${SITE_ORIGIN}/agendar` });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
				assert.equal(page.rootClasses.contains('avuz-embed-checked'), true);
			});

			it('stays off for an allowlisted origin with a different port', () => {
				const page = loadBookingPage({ ancestorOrigins: [`${SITE_ORIGIN}:8443`] });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
			});
		});

		describe('without location.ancestorOrigins (referrer fallback)', () => {
			it('turns on when the referrer origin is allowlisted', () => {
				const page = loadBookingPage({ ancestorOrigins: null, referrer: `${SITE_ORIGIN}/agendar` });

				assert.equal(page.rootClasses.contains('avuz-embed'), true);
			});

			it('stays off when the referrer origin is not allowlisted', () => {
				const page = loadBookingPage({ ancestorOrigins: null, referrer: `${OTHER_ORIGIN}/agendar` });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
				assert.equal(page.rootClasses.contains('avuz-embed-checked'), true);
			});

			it('stays off without a referrer', () => {
				const page = loadBookingPage({ ancestorOrigins: null, referrer: '' });

				assert.equal(page.rootClasses.contains('avuz-embed'), false);
			});
		});
	});

	describe('avuz:resize', () => {
		describe('in embed mode', () => {
			it('posts the #content height, not the page height, to the exact allowlisted origin on load', () => {
				const page = loadBookingPage({ height: 812.4 });
				page.flushFrames();

				assert.deepEqual(resizeMessages(page.posted), [
					{ message: { type: 'avuz:resize', height: 813 }, targetOrigin: SITE_ORIGIN },
				]);
			});

			it('observes only the #content wrapper', () => {
				const page = loadBookingPage();

				assert.deepEqual(page.observers.map((observer) => observer.targets), [[page.measured]]);
			});

			it('falls back to document.body without a #content wrapper', () => {
				const page = loadBookingPage({ hasContentWrapper: false, height: 640 });
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [640]);
				assert.deepEqual(page.observers.map((observer) => observer.targets), [[page.measured]]);
			});

			it('posts again when the content grows', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.setHeight(1400);
				page.notifyObservers();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [900, 1400]);
			});

			it('posts again when the content shrinks', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.setHeight(520);
				page.notifyObservers();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [900, 520]);
			});

			it('posts again on window resize', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.setHeight(600);
				page.windowListeners.resize();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [900, 600]);
			});

			it('skips heights equal to the last one sent', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.windowListeners.resize();
				page.notifyObservers();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [900]);
			});

			it('sends one message per animation frame, with the latest height', () => {
				const page = loadBookingPage();
				page.setHeight(1000);
				page.notifyObservers();
				page.setHeight(1100);
				page.windowListeners.resize();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [1100]);
			});

			it('waits for DOMContentLoaded while the document is loading', () => {
				const page = loadBookingPage({ readyState: 'loading' });
				page.flushFrames();
				assert.equal(page.posted.length, 0);

				page.documentListeners.DOMContentLoaded();
				page.flushFrames();

				assert.deepEqual(sentHeights(page), [900]);
			});

			it('carries only type and height', () => {
				const page = loadBookingPage();
				page.flushFrames();

				assert.deepEqual(Object.keys(resizeMessages(page.posted)[0].message), ['type', 'height']);
			});
		});

		describe('outside embed mode', () => {
			const cases = {
				'without embed=1': { search: '' },
				'when the parent origin is not allowlisted': { ancestorOrigins: [OTHER_ORIGIN] },
				'when the allowlist is empty': { allowedOrigins: [] },
				'when not framed': { embedded: false },
			};
			for (const [name, options] of Object.entries(cases)) {
				it(`watches and posts nothing ${name}`, () => {
					const page = loadBookingPage(options);
					page.flushFrames();

					assert.deepEqual(resizeMessages(page.posted), []);
					assert.equal(page.observers.length, 0);
					assert.equal(page.windowListeners.resize, undefined);
				});
			}
		});
	});

	describe('avuz:appointment-booked', () => {
		it('posts start, end and timeZone only, to the exact allowlisted origin', () => {
			const page = loadBookingPage();
			page.book({ start: 1, end: 2, timeZone: 'America/Sao_Paulo', displayName: 'Ana', email: 'ana@example.com' });

			assert.deepEqual(bookedMessages(page.posted), [
				{ message: { type: 'avuz:appointment-booked', start: 1, end: 2, timeZone: 'America/Sao_Paulo' }, targetOrigin: SITE_ORIGIN },
			]);
		});

		it('still posts when framed by an allowlisted origin without embed=1', () => {
			const page = loadBookingPage({ search: '' });
			page.book({ start: 1, end: 2, timeZone: 'UTC' });

			assert.equal(bookedMessages(page.posted).length, 1);
		});

		it('posts nothing to a non-allowlisted parent', () => {
			const page = loadBookingPage({ ancestorOrigins: [OTHER_ORIGIN] });
			page.book({ start: 1, end: 2, timeZone: 'UTC' });

			assert.deepEqual(bookedMessages(page.posted), []);
		});
	});
});
