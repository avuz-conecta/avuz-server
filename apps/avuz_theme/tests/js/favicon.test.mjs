import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ICONS_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/material-icons.js', import.meta.url)), 'utf8');
const FAVICON_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/favicon.js', import.meta.url)), 'utf8');
const SERVER_FAVICON = 'https://conecta.example/apps/theming/favicon';

function openPage(path, { icons = true } = {}) {
	const dom = new JSDOM(`<!doctype html><html><head>
		<link rel="icon" href="${SERVER_FAVICON}">
		<link rel="apple-touch-icon" href="${SERVER_FAVICON}">
	</head><body></body></html>`, { runScripts: 'outside-only', url: `https://conecta.example${path}` });
	const { window } = dom;
	if (icons) {
		window.eval(ICONS_SCRIPT);
	}
	window.eval(FAVICON_SCRIPT);

	const iconHrefs = () => [...window.document.querySelectorAll('link[rel*="icon"]')].map((link) => link.href);
	const drawnFavicon = () => {
		const href = iconHrefs()[0];
		return href.startsWith('data:image/svg+xml;base64,') ? window.atob(href.split(',')[1]) : href;
	};
	return { window, iconHrefs, drawnFavicon };
}

const glyphPath = (page, glyph) => page.window.AvuzIcons.glyphs[glyph].regular;

describe('favicon', () => {
	describe('in an app with a glyph', () => {
		it('shows the app glyph in Avuz blue on every icon link', () => {
			const page = openPage('/apps/files/');

			assert.ok(page.drawnFavicon().includes(`<path d="${glyphPath(page, 'folder')}"/>`));
			assert.ok(page.drawnFavicon().includes('fill="#2bb5e3"'));
			assert.equal(new Set(page.iconHrefs()).size, 1);
		});

		it('tells ConectaMail apart from Mail by its app path', () => {
			const page = openPage('/index.php/apps/conectamail/');

			assert.ok(page.drawnFavicon().includes(glyphPath(page, 'mail')));
		});
	});

	describe('on the start page', () => {
		it('shows the dashboard glyph', () => {
			const page = openPage('/');

			assert.ok(page.drawnFavicon().includes(glyphPath(page, 'space_dashboard')));
		});
	});

	describe('in an app without a glyph', () => {
		it('keeps the server favicon', () => {
			const page = openPage('/apps/external/1');

			assert.deepEqual(page.iconHrefs(), [SERVER_FAVICON, SERVER_FAVICON]);
		});
	});

	describe('during in-app navigation', () => {
		it('follows the app the page navigates to', () => {
			const page = openPage('/apps/files/');

			page.window.history.pushState({}, '', '/apps/calendar/');

			assert.ok(page.drawnFavicon().includes(glyphPath(page, 'calendar_today')));
		});
	});

	describe('without the icon set', () => {
		it('keeps the server favicon', () => {
			const page = openPage('/apps/files/', { icons: false });

			assert.deepEqual(page.iconHrefs(), [SERVER_FAVICON, SERVER_FAVICON]);
		});
	});
});
