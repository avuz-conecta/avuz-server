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
const RESIZE_SETTLE_MS = 100;
const TIME_ZONE_LISTBOX_ID = 'vs-7__listbox';

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

/** Timers that only fire when the test moves the clock. */
function fakeClock() {
	let now = 0;
	let nextId = 1;
	let timers = [];
	return {
		setTimeout(callback, delay = 0) {
			const id = nextId++;
			timers.push({ id, dueAt: now + delay, callback });
			return id;
		},
		clearTimeout(id) {
			timers = timers.filter((timer) => timer.id !== id);
		},
		advance(milliseconds) {
			now += milliseconds;
			const due = timers.filter((timer) => timer.dueAt <= now).sort((first, second) => first.dueAt - second.dueAt);
			timers = timers.filter((timer) => timer.dueAt > now);
			due.forEach((timer) => timer.callback());
		},
	};
}

/** Just the DOM the time zone picker exposes: combobox, toggle and whatever lands after the toggle. */
function fakeTimeZonePicker(listboxId) {
	const toggle = {
		nextElement: null,
		insertAdjacentElement(position, element) {
			if (position === 'afterend') {
				this.nextElement = element;
			}
		},
	};
	const combobox = {
		getAttribute: (name) => (name === 'aria-controls' ? listboxId : null),
	};
	const selectors = { '[aria-controls]': combobox, '.vs__dropdown-toggle': toggle };
	return {
		toggle,
		querySelector: (selector) => selectors[selector] ?? null,
	};
}

function fakeMenu(id, className = 'vs__dropdown-menu') {
	const classList = new FakeClassList();
	classList.add(className);
	return { id, classList };
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
	const mutationObservers = [];
	const clock = fakeClock();
	const timeZonePicker = fakeTimeZonePicker(TIME_ZONE_LISTBOX_ID);
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

	class FakeMutationObserver {
		constructor(callback) {
			this.callback = callback;
			this.targets = [];
			mutationObservers.push(this);
		}

		observe(target, options) {
			this.targets.push({ target, options });
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
		MutationObserver: FakeMutationObserver,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
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
			querySelector: (selector) => (selector === '.booking__time-zone' ? timeZonePicker : null),
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
		mutationObservers,
		timeZoneToggle: timeZonePicker.toggle,
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
		advance(milliseconds) {
			clock.advance(milliseconds);
		},
		/** Lets the layout settle, then paints. */
		settle() {
			clock.advance(RESIZE_SETTLE_MS);
			this.flushFrames();
		},
		appendToBody(node) {
			mutationObservers.forEach((observer) => observer.callback([{ addedNodes: [node] }]));
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
				page.settle();

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
				page.settle();

				assert.deepEqual(sentHeights(page), [640]);
				assert.deepEqual(page.observers.map((observer) => observer.targets), [[page.measured]]);
			});

			it('posts again when the content grows', () => {
				const page = loadBookingPage();
				page.settle();

				page.setHeight(1400);
				page.notifyObservers();
				page.settle();

				assert.deepEqual(sentHeights(page), [900, 1400]);
			});

			it('posts again when the content shrinks', () => {
				const page = loadBookingPage();
				page.settle();

				page.setHeight(520);
				page.notifyObservers();
				page.settle();

				assert.deepEqual(sentHeights(page), [900, 520]);
			});

			it('posts again on window resize', () => {
				const page = loadBookingPage();
				page.settle();

				page.setHeight(600);
				page.windowListeners.resize();
				page.settle();

				assert.deepEqual(sentHeights(page), [900, 600]);
			});

			it('skips heights equal to the last one sent', () => {
				const page = loadBookingPage();
				page.settle();

				page.windowListeners.resize();
				page.notifyObservers();
				page.settle();

				assert.deepEqual(sentHeights(page), [900]);
			});

			describe('while the layout is still changing', () => {
				it('waits until the content stops changing size', () => {
					const page = loadBookingPage();
					page.settle();

					page.setHeight(1100);
					page.notifyObservers();
					page.advance(RESIZE_SETTLE_MS - 1);
					page.flushFrames();
					assert.deepEqual(sentHeights(page), [900]);

					page.advance(1);
					page.flushFrames();

					assert.deepEqual(sentHeights(page), [900, 1100]);
				});

				it('posts a burst of changes once, with the final height', () => {
					const page = loadBookingPage();
					page.settle();

					page.setHeight(1000);
					page.notifyObservers();
					page.advance(40);
					page.flushFrames();
					page.setHeight(1422);
					page.notifyObservers();
					page.advance(40);
					page.flushFrames();
					page.setHeight(1100);
					page.windowListeners.resize();
					page.settle();

					assert.deepEqual(sentHeights(page), [900, 1100]);
				});

				it('posts nothing for a spike that settles back to the last height sent', () => {
					const page = loadBookingPage();
					page.settle();

					page.setHeight(1422);
					page.notifyObservers();
					page.advance(40);
					page.flushFrames();
					page.setHeight(900);
					page.notifyObservers();
					page.settle();

					assert.deepEqual(sentHeights(page), [900]);
				});
			});

			it('waits for DOMContentLoaded while the document is loading', () => {
				const page = loadBookingPage({ readyState: 'loading' });
				page.settle();
				assert.equal(page.posted.length, 0);

				page.documentListeners.DOMContentLoaded();
				page.settle();

				assert.deepEqual(sentHeights(page), [900]);
			});

			it('carries only type and height', () => {
				const page = loadBookingPage();
				page.settle();

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
					page.settle();

					assert.deepEqual(resizeMessages(page.posted), []);
					assert.equal(page.observers.length, 0);
					assert.equal(page.windowListeners.resize, undefined);
				});
			}
		});
	});

	describe('time zone options list', () => {
		describe('in embed mode', () => {
			it('moves the list vue-select appends to <body> back right after the time zone toggle', () => {
				const page = loadBookingPage();
				const menu = fakeMenu(TIME_ZONE_LISTBOX_ID);

				page.appendToBody(menu);

				assert.equal(page.timeZoneToggle.nextElement, menu);
			});

			it('leaves the list of another select where it is', () => {
				const page = loadBookingPage();

				page.appendToBody(fakeMenu('vs-99__listbox'));

				assert.equal(page.timeZoneToggle.nextElement, null);
			});

			it('leaves other elements appended to <body> where they are', () => {
				const page = loadBookingPage();

				page.appendToBody(fakeMenu(TIME_ZONE_LISTBOX_ID, 'toast'));

				assert.equal(page.timeZoneToggle.nextElement, null);
			});

			it('starts watching after DOMContentLoaded while the document is loading', () => {
				const page = loadBookingPage({ readyState: 'loading' });
				assert.equal(page.mutationObservers.length, 0);

				page.documentListeners.DOMContentLoaded();
				const menu = fakeMenu(TIME_ZONE_LISTBOX_ID);
				page.appendToBody(menu);

				assert.equal(page.timeZoneToggle.nextElement, menu);
			});
		});

		describe('outside embed mode', () => {
			it('leaves the list on <body>', () => {
				const page = loadBookingPage({ search: '' });

				page.appendToBody(fakeMenu(TIME_ZONE_LISTBOX_ID));

				assert.equal(page.mutationObservers.length, 0);
				assert.equal(page.timeZoneToggle.nextElement, null);
			});
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
