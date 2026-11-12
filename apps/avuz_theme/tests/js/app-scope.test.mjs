import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/app-scope.js', import.meta.url)), 'utf8');
const STYLESHEET_DIRECTORY = new URL('../../css/', import.meta.url);

function pageAt(path, body = '') {
	const { window } = new JSDOM(`<!doctype html><html><body id="body-user">${body}</body></html>`, { url: `https://conecta.example${path}`, runScripts: 'outside-only' });
	window.eval(SCRIPT);
	const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));
	return { window, document: window.document, settle };
}

describe('marcadores de app e de painel (js/app-scope.js)', () => {
	it('names the open app on the page, from the address', () => {
		assert.equal(pageAt('/apps/deck/board/12').document.documentElement.dataset.avuzApp, 'deck');
		assert.equal(pageAt('/index.php/apps/calendar/dayGridMonth/now').document.documentElement.dataset.avuzApp, 'calendar');
		assert.equal(pageAt('/settings/user').document.documentElement.dataset.avuzApp, undefined);
	});

	it('marks a card panel once its tabs appear', async () => {
		const page = pageAt('/apps/deck/board/12', '<div class="modal-container"><aside id="app-sidebar-vue"></aside></div>');
		page.document.getElementById('app-sidebar-vue').innerHTML = '<button id="tab-button-details"></button>';
		await page.settle();
		assert.equal(page.document.getElementById('app-sidebar-vue').dataset.avuzSidebar, 'card');
	});

	it('keeps the card panel marked when Vue rewrites its classes on a later render', async () => {
		const page = pageAt('/apps/deck/board/12', '<div class="modal-container"><aside id="app-sidebar-vue" class="app-sidebar"></aside></div>');
		const sidebar = page.document.getElementById('app-sidebar-vue');
		sidebar.innerHTML = '<button id="tab-button-details"></button>';
		await page.settle();
		sidebar.className = 'app-sidebar app-sidebar--has-preview';
		await page.settle();
		assert.equal(sidebar.dataset.avuzSidebar, 'card');
	});

	it('marks the board panel and the page while it is open, and unmarks the page when it closes', async () => {
		const page = pageAt('/apps/deck/board/12', '<div id="content-vue" class="app-deck"></div>');
		page.document.getElementById('content-vue').innerHTML = '<aside id="app-sidebar-vue"><section id="tab-sharing"></section></aside>';
		await page.settle();
		assert.equal(page.document.getElementById('app-sidebar-vue').dataset.avuzSidebar, 'board');
		assert.ok(page.document.documentElement.classList.contains('avuz-board-sidebar-open'));

		page.document.getElementById('app-sidebar-vue').remove();
		await page.settle();
		assert.ok(!page.document.documentElement.classList.contains('avuz-board-sidebar-open'));
	});

	it('marks the page while Calendar\'s new-event editor is open', async () => {
		const page = pageAt('/apps/calendar/', '<div id="content-vue" class="app-calendar"><div class="simple-editor-anchor"></div></div>');
		page.document.querySelector('.simple-editor-anchor').innerHTML = '<div><div class="modal-mask"></div></div>';
		await page.settle();
		assert.ok(page.document.documentElement.classList.contains('avuz-calendar-editor-open'));

		page.document.querySelector('.simple-editor-anchor').innerHTML = '';
		await page.settle();
		assert.ok(!page.document.documentElement.classList.contains('avuz-calendar-editor-open'));
	});

	it('marks the "Todos os painéis" page and the filter popover', async () => {
		const page = pageAt('/apps/deck/', '<main id="app-content-vue"></main><div class="v-popper__inner"><div class="filter"></div></div>');
		page.document.getElementById('app-content-vue').innerHTML = '<div class="board-list"></div>';
		page.document.querySelector('.filter').innerHTML = '<div class="filter--item"></div>';
		await page.settle();
		assert.equal(page.document.getElementById('app-content-vue').dataset.avuzContent, 'board-list');
		assert.equal(page.document.querySelector('.filter').dataset.avuzFilter, 'items');
	});
});

describe('folhas de estilo do tema em quadros grandes', () => {
	/* Each of these made Chrome restyle the whole page on every change: on a
	   360-card board a card took ~11 s to open (0.5 s without them) */
	const SLOW_SCOPES = [/#app-sidebar-vue:has\(/, /body[^{,]*:has\(\.app-/, /:has\(\.app-deck/, /#app-content-vue:has\(/, /\.filter:has\(/, /body#body-user:has\(/];

	it('scope by app and panel with markers, never with :has()', () => {
		const offenders = readdirSync(STYLESHEET_DIRECTORY).filter((file) => file.endsWith('.css')).flatMap((file) => readFileSync(new URL(file, STYLESHEET_DIRECTORY), 'utf8')
			.split('\n')
			.filter((line) => SLOW_SCOPES.some((pattern) => pattern.test(line)))
			.map((line) => `${file}: ${line.trim().slice(0, 100)}`));
		assert.deepEqual(offenders, []);
	});
});
