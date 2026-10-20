import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/resize.js', import.meta.url)), 'utf8');
const VIEWPORT_HEIGHT = 900;
const CARD_MARGIN = 8;

/**
 * The Mail page as the server renders it. jsdom has no layout, so the card
 * (#content or #content-vue) and the frame report the boxes given here.
 */
function openMailPage({ containerId = 'content', frameTop, cardBottom }) {
	const dom = new JSDOM(`<!doctype html><html><body id="body-user">
		<div id="${containerId}"><div><iframe id="roundcube-frame" src="https://webmail.example/"></iframe></div></div>
	</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://conecta.example/apps/conectamail/' });
	const { window } = dom;
	const boxes = { frameTop, cardBottom };
	Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => VIEWPORT_HEIGHT });
	window.HTMLElement.prototype.getBoundingClientRect = function boundingBox() {
		if (this.id === 'roundcube-frame') {
			return { top: boxes.frameTop, bottom: boxes.frameTop + 1, left: 0, right: 0, width: 0, height: 1 };
		}
		if (this.id === containerId) {
			return { top: CARD_MARGIN, bottom: boxes.cardBottom, left: 0, right: 0, width: 0, height: boxes.cardBottom - CARD_MARGIN };
		}
		return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
	};
	window.OC = { generateUrl: (path) => path, requestToken: 'token' };
	window.eval(SCRIPT);
	const frame = window.document.getElementById('roundcube-frame');
	return { window, frame, boxes };
}

describe('Mail frame size', () => {
	it('fills the card down to its bottom edge, not the window bottom (left rail layout)', () => {
		const page = openMailPage({ frameTop: CARD_MARGIN, cardBottom: VIEWPORT_HEIGHT - CARD_MARGIN });

		assert.equal(page.frame.style.height, `${VIEWPORT_HEIGHT - 2 * CARD_MARGIN}px`);
	});

	it('fills the card under the top header too', () => {
		const page = openMailPage({ frameTop: 50, cardBottom: VIEWPORT_HEIGHT - CARD_MARGIN });

		assert.equal(page.frame.style.height, `${VIEWPORT_HEIGHT - CARD_MARGIN - 50}px`);
	});

	it('fits a Vue page container (#content-vue)', () => {
		const page = openMailPage({ containerId: 'content-vue', frameTop: CARD_MARGIN, cardBottom: VIEWPORT_HEIGHT - CARD_MARGIN });

		assert.equal(page.frame.style.height, `${VIEWPORT_HEIGHT - 2 * CARD_MARGIN}px`);
	});

	it('follows the card when the window resizes', () => {
		const page = openMailPage({ frameTop: CARD_MARGIN, cardBottom: VIEWPORT_HEIGHT - CARD_MARGIN });

		page.boxes.cardBottom = 600 - CARD_MARGIN;
		page.window.dispatchEvent(new page.window.Event('resize'));

		assert.equal(page.frame.style.height, `${600 - 2 * CARD_MARGIN}px`);
	});
});
