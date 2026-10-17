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
const HTTP_OK = 200;

function encodeOrigins(origins) {
	return Buffer.from(JSON.stringify(origins)).toString('base64');
}

function loadBookingPage({ embedded = true, parentOrigin = SITE_ORIGIN, allowedOrigins = [SITE_ORIGIN], height = 900, readyState = 'complete' } = {}) {
	const posted = [];
	const frameCallbacks = [];
	const windowListeners = {};
	const documentListeners = {};
	const observers = [];
	const documentElement = { scrollHeight: height };
	const stateElement = allowedOrigins.length > 0 ? { value: encodeOrigins(allowedOrigins) } : null;

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
			href: `https://cloud.example${BOOKING_PATH}`,
			origin: 'https://cloud.example',
			ancestorOrigins: embedded ? [parentOrigin] : [],
		},
		document: {
			readyState,
			referrer: '',
			documentElement,
			body: { scrollHeight: height },
			getElementById: (id) => (id === 'initial-state-avuz_theme-embedAllowedOrigins' ? stateElement : null),
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
		setHeight(newHeight) {
			documentElement.scrollHeight = newHeight;
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

describe('appointment-embed', () => {
	describe('avuz:resize', () => {
		describe('when embedded by an allowlisted origin', () => {
			it('posts the content height to that exact origin on load', () => {
				const page = loadBookingPage({ height: 812.4 });
				page.flushFrames();

				assert.deepEqual(resizeMessages(page.posted), [
					{ message: { type: 'avuz:resize', height: 813 }, targetOrigin: SITE_ORIGIN },
				]);
			});

			it('posts again when an observed element changes height', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.setHeight(1400);
				page.observers.forEach((observer) => observer.callback());
				page.flushFrames();

				assert.deepEqual(resizeMessages(page.posted).map(({ message }) => message.height), [900, 1400]);
			});

			it('posts again on window resize', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.setHeight(600);
				page.windowListeners.resize();
				page.flushFrames();

				assert.deepEqual(resizeMessages(page.posted).map(({ message }) => message.height), [900, 600]);
			});

			it('skips heights equal to the last one sent', () => {
				const page = loadBookingPage();
				page.flushFrames();

				page.windowListeners.resize();
				page.observers.forEach((observer) => observer.callback());
				page.flushFrames();

				assert.equal(resizeMessages(page.posted).length, 1);
			});

			it('sends one message per animation frame', () => {
				const page = loadBookingPage();
				page.windowListeners.resize();
				page.windowListeners.resize();
				page.flushFrames();

				assert.equal(resizeMessages(page.posted).length, 1);
			});

			it('waits for DOMContentLoaded while the document is loading', () => {
				const page = loadBookingPage({ readyState: 'loading' });
				page.flushFrames();
				assert.equal(page.posted.length, 0);

				page.documentListeners.DOMContentLoaded();
				page.flushFrames();

				assert.equal(resizeMessages(page.posted).length, 1);
			});

			it('carries only type and height', () => {
				const page = loadBookingPage();
				page.flushFrames();

				assert.deepEqual(Object.keys(resizeMessages(page.posted)[0].message), ['type', 'height']);
			});
		});

		describe('when the parent origin is not allowlisted', () => {
			it('posts nothing', () => {
				const page = loadBookingPage({ parentOrigin: OTHER_ORIGIN });
				page.flushFrames();

				assert.deepEqual(page.posted, []);
				assert.equal(page.observers.length, 0);
			});
		});

		describe('when the allowlist is empty', () => {
			it('posts nothing', () => {
				const page = loadBookingPage({ allowedOrigins: [] });
				page.flushFrames();

				assert.deepEqual(page.posted, []);
				assert.equal(page.observers.length, 0);
			});
		});

		describe('when not embedded', () => {
			it('watches nothing', () => {
				const page = loadBookingPage({ embedded: false });
				page.flushFrames();

				assert.equal(page.observers.length, 0);
				assert.equal(page.windowListeners.resize, undefined);
			});
		});
	});

	describe('avuz:appointment-booked', () => {
		it('posts start, end and timeZone only, to the exact allowlisted origin', () => {
			const page = loadBookingPage();
			page.book({ start: 1, end: 2, timeZone: 'America/Sao_Paulo', displayName: 'Ana', email: 'ana@example.com' });

			assert.deepEqual(page.posted.filter(({ message }) => message.type === 'avuz:appointment-booked'), [
				{ message: { type: 'avuz:appointment-booked', start: 1, end: 2, timeZone: 'America/Sao_Paulo' }, targetOrigin: SITE_ORIGIN },
			]);
		});
	});
});
