import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DASHBOARD_STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/dashboard.css', import.meta.url)), 'utf8');

const widgetHeaderIcon = (iconMarkup) => {
	const { window } = new JSDOM(`<style>${DASHBOARD_STYLESHEET}</style>
		<div id="app-dashboard"><div class="panels"><div class="panel">
			<div class="panel--header"><h2>${iconMarkup} Vence hoje</h2></div>
		</div></div></div>`);
	const icon = window.document.querySelector('.panel--header h2 > *');
	return window.getComputedStyle(icon);
};

describe('Painel inicial', () => {
	describe('ícone de widget desenhado por classe (Tarefas: Vence hoje, Próximos cartões)', () => {
		const icon = widgetHeaderIcon('<span class="icon-deck" aria-hidden="true"></span>');

		it('draws the icon once, without tiling', () => {
			assert.equal(icon.backgroundRepeat, 'no-repeat');
		});

		it('centers the icon in its tile', () => {
			assert.match(icon.backgroundPosition, /^(center|50% 50%|center center)$/);
		});

		it('fits the icon inside the tile padding', () => {
			assert.equal(icon.backgroundSize, '18px 18px');
		});
	});
});
