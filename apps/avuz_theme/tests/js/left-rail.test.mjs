import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const MODEL_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/left-rail-model.js', import.meta.url)), 'utf8');
const RAIL_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/left-rail.js', import.meta.url)), 'utf8');
const ICONS_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/material-icons.js', import.meta.url)), 'utf8');
const ITEM_HEIGHT = 44;
const ROOMY_RAIL = 20 * ITEM_HEIGHT;

const APPS = [
	{ id: 'dashboard', name: 'Painel', href: '/apps/dashboard/', icon: '/core/img/dashboard.svg', active: false },
	{ id: 'files', name: 'Drive', href: '/apps/files/', icon: '/core/img/files.svg', active: false },
	{ id: 'conectamail', name: 'Mail', href: '/apps/conectamail/', icon: '/apps/conectamail/img/mail.svg', active: true },
	{ id: 'deck', name: 'Tarefas', href: '/apps/deck/', icon: '/apps/deck/img/deck.svg', active: false },
	{ id: 'forms', name: 'Formulários', href: '/apps/forms/', icon: '/apps/forms/img/forms.svg', active: false },
];
const EXTERNAL_SITE = { id: 'external_index1', name: 'Portal', href: '/apps/external/1', icon: '/apps/external/icons/globe.svg', active: false, target: false };
const UPLOADED_ICON_SITE = { id: 'external_index2', name: 'Cliente', href: '/apps/external/2', icon: '/apps/external/icons/logo-cliente.png', active: false, target: false };
const REDIRECT_SITE = { id: 'external_index3', name: 'Banco', href: 'https://banco.example/', icon: '/apps/external/icons/landmark-dark.svg', active: false, target: true };

const encodeState = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

function stateInput(app, key, value) {
	return `<input type="hidden" id="initial-state-${app}-${key}" value="${encodeState(value)}">`;
}

/**
 * A logged-in page as the server renders it, with both scripts run in it.
 * jsdom has no layout, so the rail's app list reports `railHeight`.
 */
function openPage({ apps = APPS, bodyId = 'body-user', icons = true, loggedIn = true, railHeight = ROOMY_RAIL } = {}) {
	const dom = new JSDOM(`<!doctype html><html><body id="${loggedIn ? bodyId : 'body-login'}">
		<div id="initial-state-container">${stateInput('core', 'apps', apps)}</div>
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

	if (icons) {
		window.eval(ICONS_SCRIPT);
	}
	window.eval(MODEL_SCRIPT);
	window.eval(RAIL_SCRIPT);
	window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

	const rail = () => window.document.querySelector('nav[aria-label="Aplicativos"]');
	const moreButton = () => [...rail().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Mais aplicativos');
	const visibleLinks = () => [...rail().querySelectorAll('a')].filter((link) => !link.closest('[hidden]'));
	const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

	return { window, document: window.document, rail, moreButton, visibleLinks, height, nextFrame };
}

/** The path data a control draws, or the image it shows. */
const drawnPath = (control) => control.querySelector('svg path')?.getAttribute('d');
const glyph = (page, name) => page.window.AvuzIcons.glyphs[name];

const names = (links) => links.map((link) => link.textContent.trim());

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
			const page = openPage({ apps: [...APPS, UPLOADED_ICON_SITE] });

			const [glyphIcon, imageIcon] = [page.visibleLinks()[0].querySelector('svg'), page.visibleLinks()[5].querySelector('img')];
			assert.equal(glyphIcon.getAttribute('aria-hidden'), 'true');
			assert.equal(imageIcon.getAttribute('alt'), '');
		});
	});

	describe('icons', () => {
		it('draws each known app with its Material glyph', () => {
			const page = openPage();

			const [dashboard, files] = page.visibleLinks();
			assert.equal(drawnPath(dashboard), glyph(page, 'space_dashboard').regular);
			assert.equal(drawnPath(files), glyph(page, 'folder').regular);
			assert.equal(files.querySelector('img'), null);
		});

		it('fills the glyph of the current app', () => {
			const page = openPage();

			const current = page.visibleLinks().find((link) => link.getAttribute('aria-current') === 'page');
			assert.equal(drawnPath(current), glyph(page, 'mail').fill);
		});

		it('keeps the app image for an app without a glyph', () => {
			const page = openPage({ apps: [...APPS, UPLOADED_ICON_SITE] });

			const site = page.visibleLinks().find((link) => link.textContent.trim() === 'Cliente');
			assert.equal(site.querySelector('svg'), null);
			assert.equal(site.querySelector('img').getAttribute('src'), UPLOADED_ICON_SITE.icon);
		});

		describe('of external sites', () => {
			it('draws a library icon with its Material glyph', () => {
				const page = openPage({ apps: [...APPS, EXTERNAL_SITE] });

				const portal = page.visibleLinks().find((link) => link.textContent.trim() === 'Portal');
				assert.equal(drawnPath(portal), glyph(page, 'language').regular);
				assert.equal(portal.querySelector('img'), null);
			});

			it('draws the dark file of a library icon with the same glyph', () => {
				const page = openPage({ apps: [...APPS, REDIRECT_SITE] });

				assert.equal(drawnPath(page.visibleLinks()[5]), glyph(page, 'account_balance').regular);
			});

			it('fills the glyph of the open site', () => {
				const page = openPage({ apps: [...APPS.map((app) => ({ ...app, active: false })), { ...EXTERNAL_SITE, active: true }] });

				const current = page.visibleLinks().find((link) => link.getAttribute('aria-current') === 'page');
				assert.equal(drawnPath(current), glyph(page, 'language').fill);
			});

			it("draws the External sites default icon with a glyph too", () => {
				const page = openPage({ apps: [...APPS, { ...EXTERNAL_SITE, icon: '/apps/external/icons/external.svg' }] });

				assert.equal(drawnPath(page.visibleLinks()[5]), glyph(page, 'language').regular);
			});
		});

		it('shows every app image when the icon set did not load', () => {
			const page = openPage({ icons: false });

			assert.deepEqual(page.visibleLinks().map((link) => link.querySelector('img')?.getAttribute('src')), APPS.map((app) => app.icon));
		});

		it('hands search and notifications their Material glyphs for the rail foot', () => {
			const page = openPage();

			const root = page.document.documentElement;
			const maskedPath = (property) => {
				const value = root.style.getPropertyValue(property);
				const svg = page.window.atob(value.match(/base64,([^")]+)/)[1]);
				return svg.match(/ d="([^"]+)"/)[1];
			};
			assert.equal(root.classList.contains('avuz-rail--material-foot'), true);
			assert.equal(maskedPath('--avuz-rail-icon-search'), glyph(page, 'search').regular);
			assert.equal(maskedPath('--avuz-rail-icon-notifications'), glyph(page, 'notifications').regular);
		});

		it('leaves the foot icons to core when the icon set did not load', () => {
			const page = openPage({ icons: false });

			assert.equal(page.document.documentElement.classList.contains('avuz-rail--material-foot'), false);
		});

		it('draws "Mais aplicativos" with its Material glyph', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });

			assert.equal(drawnPath(page.moreButton()), glyph(page, 'more_horiz').regular);
		});
	});

	describe('on a settings page', () => {
		it('renders the rail with every app, as on an app page', () => {
			const page = openPage({ bodyId: 'body-settings' });

			assert.ok(page.rail());
			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Drive', 'Mail', 'Tarefas', 'Formulários']);
		});
	});

	describe('on a guest page', () => {
		it('renders no rail', () => {
			const page = openPage({ loggedIn: false });

			assert.equal(page.rail(), null);
		});
	});

	describe('icons only', () => {
		it('offers no control to expand the rail', () => {
			const page = openPage();

			assert.deepEqual([...page.rail().querySelectorAll('button')], []);
		});

		it('keeps each app name in its link, for the tooltip and screen readers', () => {
			const page = openPage();

			assert.deepEqual(names(page.visibleLinks()), ['Painel', 'Drive', 'Mail', 'Tarefas', 'Formulários']);
		});

		it('sets no native title, whose delayed tooltip would double the instant one', () => {
			const page = openPage({ railHeight: 3 * ITEM_HEIGHT });

			page.moreButton().click();

			assert.deepEqual([...page.rail().querySelectorAll('[title]')], []);
		});
	});

	describe('tooltip', () => {
		const dismissed = (page) => page.rail().classList.contains('avuz-rail--tooltip-dismissed');
		const pressEscape = (page) => page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		const hover = (page, control) => control.querySelector('.avuz-rail__icon').dispatchEvent(new page.window.MouseEvent('mouseover', { bubbles: true }));

		it('hides on Escape while an icon is hovered', () => {
			const page = openPage();
			hover(page, page.visibleLinks()[1]);

			pressEscape(page);

			assert.equal(dismissed(page), true);
		});

		it('hides on Escape while an icon has keyboard focus', () => {
			const page = openPage();
			page.visibleLinks()[1].focus();

			pressEscape(page);

			assert.equal(dismissed(page), true);
		});

		it('stays hidden while the pointer moves within the same icon', () => {
			const page = openPage();
			const drive = page.visibleLinks()[1];
			hover(page, drive);
			pressEscape(page);

			drive.dispatchEvent(new page.window.MouseEvent('mouseover', { bubbles: true }));

			assert.equal(dismissed(page), true);
		});

		it('shows again on the next icon', () => {
			const page = openPage();
			hover(page, page.visibleLinks()[1]);
			pressEscape(page);

			hover(page, page.visibleLinks()[2]);

			assert.equal(dismissed(page), false);
		});

		it('shows again once focus leaves the icon', () => {
			const page = openPage();
			page.visibleLinks()[1].focus();
			pressEscape(page);

			page.document.getElementById('outside').focus();

			assert.equal(dismissed(page), false);
		});

		it('ignores Escape before any icon was hovered or focused', () => {
			const page = openPage();

			pressEscape(page);

			assert.equal(dismissed(page), false);
		});
	});

	describe('external sites that open outside', () => {
		it('opens a redirect site in a new tab, without handing it this page', () => {
			const page = openPage({ apps: [...APPS, REDIRECT_SITE] });

			const site = page.visibleLinks()[5];
			assert.equal(site.getAttribute('href'), 'https://banco.example/');
			assert.equal(site.target, '_blank');
			assert.equal(site.rel, 'noopener noreferrer');
		});

		it('tells the new tab apart in its name, which the tooltip shows', () => {
			const page = openPage({ apps: [...APPS, REDIRECT_SITE] });

			const site = page.visibleLinks()[5];
			assert.equal(site.textContent.trim(), 'Banco (abre em nova aba)');
		});

		it('keeps an embedded site in the same tab', () => {
			const page = openPage({ apps: [...APPS, EXTERNAL_SITE] });

			const site = page.visibleLinks()[5];
			assert.equal(site.target, '');
			assert.equal(site.rel, '');
			assert.equal(site.textContent.trim(), 'Portal');
		});

		it('opens a redirect site in a new tab from "Mais aplicativos" too', () => {
			const page = openPage({ apps: [...APPS, REDIRECT_SITE], railHeight: 3 * ITEM_HEIGHT });

			page.moreButton().click();

			const site = page.visibleLinks().find((link) => link.getAttribute('href') === 'https://banco.example/');
			assert.equal(site.target, '_blank');
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
