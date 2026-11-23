import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/mailto-links.js', import.meta.url)), 'utf8');
const COMPOSE_URL = '/index.php/apps/conectamail/compose';

/** An Avuz Conecta page with the script loaded and window.open recorded */
function openPage(linkHtml) {
	const dom = new JSDOM(`<!doctype html><html><body>${linkHtml}</body></html>`, {
		runScripts: 'outside-only',
		url: 'https://conecta.example/apps/contacts/',
	});
	const { window } = dom;
	const opened = [];
	window.open = (url, target, features) => {
		opened.push({ url, target, features });
		return null;
	};
	window.OC = { generateUrl: (path) => `/index.php${path}` };
	window.eval(SCRIPT);
	return { window, opened };
}

function click(window, selector, options = {}) {
	const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...options });
	window.document.querySelector(selector).dispatchEvent(event);
	return event;
}

describe('e-mail links open a new ConectaMail message', () => {
	it('opens a new tab with a message to the address', () => {
		const { window, opened } = openPage('<a id="link" href="mailto:bia@cliente.com">bia@cliente.com</a>');

		const event = click(window, '#link');

		assert.equal(event.defaultPrevented, true);
		assert.deepEqual(opened, [{ url: `${COMPOSE_URL}?to=bia%40cliente.com`, target: '_blank', features: 'noopener' }]);
	});

	it('opens the message when the click lands inside the link', () => {
		const { window, opened } = openPage('<a href="mailto:bia@cliente.com"><span id="icon">✉</span></a>');

		click(window, '#icon');

		assert.equal(opened.length, 1);
	});

	it('keeps every address and drops the subject and body', () => {
		const { window, opened } = openPage('<a id="link" href="mailto:bia@cliente.com,caio@empresa.com?subject=Oi">e-mail</a>');

		click(window, '#link');

		assert.equal(opened[0].url, `${COMPOSE_URL}?to=bia%40cliente.com%2Ccaio%40empresa.com`);
	});

	it('decodes an encoded address', () => {
		const { window, opened } = openPage('<a id="link" href="mailto:bia%40cliente.com">e-mail</a>');

		click(window, '#link');

		assert.equal(opened[0].url, `${COMPOSE_URL}?to=bia%40cliente.com`);
	});

	it('leaves a link without an address alone', () => {
		const { window, opened } = openPage('<a id="link" href="mailto:?subject=Oi">e-mail</a>');

		const event = click(window, '#link');

		assert.equal(event.defaultPrevented, false);
		assert.equal(opened.length, 0);
	});

	it('leaves other links alone', () => {
		const { window, opened } = openPage('<a id="link" href="tel:+5551999999999">telefone</a>');

		const event = click(window, '#link');

		assert.equal(event.defaultPrevented, false);
		assert.equal(opened.length, 0);
	});

	for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
		it(`leaves a click with ${modifier} to the browser`, () => {
			const { window, opened } = openPage('<a id="link" href="mailto:bia@cliente.com">e-mail</a>');

			const event = click(window, '#link', { [modifier]: true });

			assert.equal(event.defaultPrevented, false);
			assert.equal(opened.length, 0);
		});
	}

	it('leaves a click another handler already took alone', () => {
		const { window, opened } = openPage('<a id="link" href="mailto:bia@cliente.com">e-mail</a>');
		window.document.querySelector('#link').addEventListener('click', (event) => event.preventDefault());

		click(window, '#link');

		assert.equal(opened.length, 0);
	});
});
