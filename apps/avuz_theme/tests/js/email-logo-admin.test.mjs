import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/email-logo-admin.js', import.meta.url)), 'utf8');
const AVUZ_LOGO = { url: 'https://ramires.example/apps/avuz_theme/img/logo-email.png', width: 140, height: 49 };
const TENANT_LOGO = { url: 'https://ramires.example/index.php/apps/avuz_theme/email-logo?v=abc', width: 120, height: 40 };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Administração › Personalização with the section as the server renders it, fetch answered by `respond` */
async function openSettings({ tenantLogo = null, respond = async () => ({ ok: true, json: async () => ({ logo: TENANT_LOGO }) }) } = {}) {
	const dom = new JSDOM(`<!doctype html><html><body>
		<div id="avuz-email-logo" data-avuz-logo='${JSON.stringify(AVUZ_LOGO)}' data-tenant-logo='${JSON.stringify(tenantLogo)}'></div>
	</body></html>`, { runScripts: 'outside-only', url: 'https://ramires.example/settings/admin/theming' });
	const { window } = dom;
	const requests = [];
	window.OC = { generateUrl: (path) => `/index.php${path}`, requestToken: 'token' };
	window.FormData = class { constructor() { this.entries = []; } append(name, value) { this.entries.push([name, value]); } };
	window.fetch = async (url, options) => {
		requests.push({ url, method: options.method, body: options.body });
		return respond(url, options);
	};
	window.eval(SCRIPT);
	await settle();
	const root = window.document.getElementById('avuz-email-logo');
	return { window, root, requests };
}

function chooseFile(window, root, name = 'logo.png') {
	const input = root.querySelector('input[type=file]');
	const file = new window.File(['png'], name, { type: 'image/png' });
	Object.defineProperty(input, 'files', { configurable: true, value: [file] });
	input.dispatchEvent(new window.Event('change'));
}

describe('Logo dos e-mails', () => {
	it('shows the Avuz Conecta logo while the tenant has none', async () => {
		const { root } = await openSettings();

		const image = root.querySelector('.avuz-elogo__preview img');
		assert.equal(image.getAttribute('src'), AVUZ_LOGO.url);
		assert.equal(root.querySelector('.avuz-elogo__caption').textContent, 'Logo do Avuz Conecta (padrão)');
		assert.equal(root.querySelector('.avuz-elogo__reset').hidden, true);
	});

	it('shows the tenant logo at the size e-mails use', async () => {
		const { root } = await openSettings({ tenantLogo: TENANT_LOGO });

		const image = root.querySelector('.avuz-elogo__preview img');
		assert.equal(image.getAttribute('src'), TENANT_LOGO.url);
		assert.equal(image.width, 120);
		assert.equal(image.height, 40);
		assert.equal(root.querySelector('.avuz-elogo__reset').hidden, false);
	});

	it('uploads a chosen file and shows the new logo', async () => {
		const { window, root, requests } = await openSettings();

		chooseFile(window, root);
		await settle();

		assert.equal(requests.length, 1);
		assert.equal(requests[0].method, 'POST');
		assert.equal(requests[0].url, '/index.php/apps/avuz_theme/email-logo');
		assert.equal(requests[0].body.entries[0][0], 'logo');
		assert.equal(root.querySelector('.avuz-elogo__preview img').getAttribute('src'), TENANT_LOGO.url);
		assert.equal(root.querySelector('.avuz-elogo__caption').textContent, 'Logo desta conta');
	});

	it('explains why the server refused a file', async () => {
		const { window, root } = await openSettings({
			respond: async () => ({ ok: false, json: async () => ({ message: 'Envie uma imagem PNG ou JPEG.' }) }),
		});

		chooseFile(window, root, 'logo.svg');
		await settle();

		const error = root.querySelector('.avuz-elogo__error');
		assert.equal(error.hidden, false);
		assert.equal(error.textContent, 'Envie uma imagem PNG ou JPEG.');
		assert.equal(root.querySelector('.avuz-elogo__preview img').getAttribute('src'), AVUZ_LOGO.url);
	});

	it('goes back to the Avuz Conecta logo', async () => {
		const { window, root, requests } = await openSettings({
			tenantLogo: TENANT_LOGO,
			respond: async () => ({ ok: true, json: async () => ({ logo: null }) }),
		});

		root.querySelector('.avuz-elogo__reset').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await settle();

		assert.equal(requests[0].method, 'DELETE');
		assert.equal(root.querySelector('.avuz-elogo__preview img').getAttribute('src'), AVUZ_LOGO.url);
		assert.equal(root.querySelector('.avuz-elogo__reset').hidden, true);
	});

	it('opens the file picker from a real button', async () => {
		const { window, root } = await openSettings();
		let opened = false;
		root.querySelector('input[type=file]').click = () => {
			opened = true;
		};

		root.querySelector('.avuz-elogo__upload').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

		assert.equal(root.querySelector('.avuz-elogo__upload').tagName, 'BUTTON');
		assert.equal(opened, true);
	});
});
