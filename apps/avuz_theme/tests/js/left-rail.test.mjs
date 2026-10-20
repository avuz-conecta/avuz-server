import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const MODEL_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/left-rail-model.js', import.meta.url)), 'utf8');
const RAIL_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/left-rail.js', import.meta.url)), 'utf8');
const ITEM_HEIGHT = 44;
const ROOMY_RAIL = 20 * ITEM_HEIGHT;
const SAVE_URL = '/ocs/v2.php/apps/provisioning_api/api/v1/config/users/avuz_theme/rail_collapsed';
const REQUEST_TOKEN = 'token-123';

const APPS = [
	{ id: 'dashboard', name: 'Painel', href: '/apps/dashboard/', icon: '/core/img/dashboard.svg', active: false },
	{ id: 'files', name: 'Drive', href: '/apps/files/', icon: '/core/img/files.svg', active: false },
	{ id: 'conectamail', name: 'Mail', href: '/apps/conectamail/', icon: '/apps/conectamail/img/mail.svg', active: true },
	{ id: 'deck', name: 'Tarefas', href: '/apps/deck/', icon: '/apps/deck/img/deck.svg', active: false },
	{ id: 'forms', name: 'Formulários', href: '/apps/forms/', icon: '/apps/forms/img/forms.svg', active: false },
];

const encodeState = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

function stateInput(app, key, value) {
	return `<input type="hidden" id="initial-state-${app}-${key}" value="${encodeState(value)}">`;
}

/**
 * A logged-in page as the server renders it, with both scripts run in it.
 * jsdom has no layout, so the rail's app list reports `railHeight`.
 */
function openPage({ collapsed = false, loggedIn = true, railHeight = ROOMY_RAIL, saveResponds = () => ({ ok: true }) } = {}) {
	const states = loggedIn ? stateInput('core', 'apps', APPS) + stateInput('avuz_theme', 'rail_collapsed', collapsed) : stateInput('core', 'apps', APPS);
	const dom = new JSDOM(`<!doctype html><html><body id="${loggedIn ? 'body-user' : 'body-login'}">
		<div id="initial-state-container">${states}</div>
		<header id="header"><div class="header-start"><nav id="header-start__appmenu"></nav></div><div class="header-end"></div></header>
		<main id="content"><a href="#" id="outside">fora</a></main>
	</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://conecta.example/apps/conectamail/' });
	const { window } = dom;

	const height = { value: railHeight };
	Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get() {
			return this.matches('nav[aria-label="Aplicativos"] ul:not([hidden])') && !this.closest('[hidden]') ? height.value : 0;
		},
	});

	const saves = [];
	const warnings = [];
	window.OC = { requestToken: REQUEST_TOKEN, linkToOCS: (service, version) => `/ocs/v${version}.php/${service}/` };
	window.fetch = async (url, init) => {
		saves.push({ url, method: init.method, body: String(init.body), token: init.headers.requesttoken, ocsHeader: init.headers['OCS-APIRequest'] });
		const response = saveResponds();
		if (response instanceof Error) {
			throw response;
		}
		return response;
	};
	window.console.warn = (...args) => warnings.push(args.join(' '));

	window.eval(MODEL_SCRIPT);
	window.eval(RAIL_SCRIPT);
	window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

	const rail = () => window.document.querySelector('nav[aria-label="Aplicativos"]');
	const toggle = () => rail().querySelector('button');
	const moreButton = () => [...rail().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Mais aplicativos');
	const visibleLinks = () => [...rail().querySelectorAll('a')].filter((link) => !link.closest('[hidden]'));
	const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

	return { window, document: window.document, rail, toggle, moreButton, visibleLinks, saves, warnings, height, nextFrame };
}

const names = (links) => links.map((link) => link.textContent.trim());
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('left rail', () => {
	describe('on a logged-in page', () => {
		it('lists every app in the user order, each linking to its app', () => {
			const page = openPage();

			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Drive', 'Mail', 'Tarefas', 'Formulários']);
			assert.deepEqual(page.visibleLinks().map((link) => link.getAttribute('href')), APPS.map((app) => app.href));
		});

		it('marks only the current app as the current page', () => {
			const page = openPage();

			const current = page.visibleLinks().filter((link) => link.getAttribute('aria-current') === 'page');
			assert.deepEqual(names(current), ['Mail']);
		});

		it('shows app icons as decoration, the name being the label', () => {
			const page = openPage();

			const icon = page.visibleLinks()[0].querySelector('img');
			assert.equal(icon.getAttribute('src'), '/core/img/dashboard.svg');
			assert.equal(icon.getAttribute('alt'), '');
		});
	});

	describe('on a guest page', () => {
		it('renders no rail', () => {
			const page = openPage({ loggedIn: false });

			assert.equal(page.rail(), null);
		});
	});

	describe('toggle', () => {
		it('starts expanded when the user never collapsed it', () => {
			const page = openPage();

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--collapsed'), false);
			assert.equal(page.toggle().textContent.trim(), 'Recolher menu');
			assert.equal(page.toggle().getAttribute('aria-expanded'), 'true');
		});

		it('starts collapsed when the user saved it collapsed', () => {
			const page = openPage({ collapsed: true });

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--collapsed'), true);
			assert.equal(page.toggle().textContent.trim(), 'Expandir menu');
			assert.equal(page.toggle().getAttribute('aria-expanded'), 'false');
		});

		it('applies the saved state on load without animating it', () => {
			const page = openPage({ collapsed: true });

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--animated'), false);
		});

		it('animates a toggle the user makes', () => {
			const page = openPage();

			page.toggle().click();

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--animated'), true);
		});

		it('collapses the rail and saves the choice', async () => {
			const page = openPage();

			page.toggle().click();
			await flush();

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--collapsed'), true);
			assert.equal(page.toggle().textContent.trim(), 'Expandir menu');
			assert.deepEqual(page.saves, [{ url: SAVE_URL, method: 'POST', body: 'configValue=1', token: REQUEST_TOKEN, ocsHeader: 'true' }]);
		});

		it('expands a collapsed rail and saves the choice', async () => {
			const page = openPage({ collapsed: true });

			page.toggle().click();
			await flush();

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--collapsed'), false);
			assert.deepEqual(page.saves.map((save) => save.body), ['configValue=0']);
		});

		it('keeps the new state and warns when saving fails', async () => {
			const page = openPage({ saveResponds: () => new Error('offline') });

			page.toggle().click();
			await flush();

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--collapsed'), true);
			assert.equal(page.warnings.length, 1);
		});

		it('warns when the server refuses the value', async () => {
			const page = openPage({ saveResponds: () => ({ ok: false, status: 400 }) });

			page.toggle().click();
			await flush();

			assert.equal(page.warnings.length, 1);
		});

		it('shows app names as tooltips only while collapsed', () => {
			const page = openPage();

			assert.equal(page.visibleLinks()[0].getAttribute('title'), null);
			page.toggle().click();
			assert.equal(page.visibleLinks()[0].getAttribute('title'), 'Painel');
		});
	});

	describe('when the apps outgrow the rail', () => {
		it('moves the extra apps behind "Mais aplicativos", keeping the current one visible', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });

			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Mail']);
			assert.ok(page.moreButton());
			assert.equal(page.moreButton().getAttribute('aria-expanded'), 'false');
		});

		it('opens the extra apps from "Mais aplicativos"', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });

			page.moreButton().click();

			assert.equal(page.moreButton().getAttribute('aria-expanded'), 'true');
			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Mail', 'Drive', 'Tarefas', 'Formulários']);
		});

		it('closes the extra apps on Escape and returns focus to "Mais aplicativos"', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });
			page.moreButton().click();

			page.document.activeElement.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

			assert.equal(page.moreButton().getAttribute('aria-expanded'), 'false');
			assert.equal(page.document.activeElement, page.moreButton());
		});

		it('closes the extra apps on a click elsewhere', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });
			page.moreButton().click();

			page.document.getElementById('outside').click();

			assert.equal(page.moreButton().getAttribute('aria-expanded'), 'false');
		});

		it('shows no "Mais aplicativos" when every app fits', () => {
			const page = openPage();

			assert.equal(page.moreButton(), undefined);
		});

		it('recomputes the split when the window resizes', async () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });

			page.height.value = ROOMY_RAIL;
			page.window.dispatchEvent(new page.window.Event('resize'));
			await page.nextFrame();
			await page.nextFrame();

			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Drive', 'Mail', 'Tarefas', 'Formulários']);
			assert.equal(page.moreButton(), undefined);
		});
	});
});
