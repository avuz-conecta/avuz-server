import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const STYLESHEET_URL = new URL('../../css/talk.css', import.meta.url);
const TALK_STYLESHEET = readFileSync(fileURLToPath(STYLESHEET_URL), 'utf8');
/* Talk's own rule for a primary button, which it uses for the menu of the open conversation */
const UPSTREAM_PRIMARY_BUTTON = '.button-vue--primary { background-color: rgb(21, 23, 27); color: rgb(255, 255, 255); }';
const SEE_THROUGH = ['transparent', 'rgba(0, 0, 0, 0)'];

const conversationMenuButton = (wrapperClass, state = '') => {
	const { window } = new JSDOM(`<style>${UPSTREAM_PRIMARY_BUTTON}</style><style>${TALK_STYLESHEET}</style>
		<div id="content-vue" class="app-talk"><ul>
			<li class="${wrapperClass}"><div class="list-item">
				<div class="list-item-content__actions"><div class="action-item action-item--primary">
					<button class="button-vue button-vue--primary action-item__menutoggle" aria-label="Ações de conversa" ${state}>
						<span class="material-design-icon dots-horizontal-icon"></span>
					</button>
				</div></div>
			</div></li>
		</ul></div>`);
	const button = window.document.querySelector('button');
	return { button: window.getComputedStyle(button), icon: window.getComputedStyle(button.querySelector('span')) };
};

describe('Talk: menu da conversa aberta', () => {
	const ACTIVE = 'list-item__wrapper list-item__wrapper--active conversation conversation--active';

	it('keeps the menu button see-through on the open conversation, like on the others', () => {
		const { button } = conversationMenuButton(ACTIVE);
		assert.ok(SEE_THROUGH.includes(button.backgroundColor), `button background is "${button.backgroundColor}"`);
	});

	it('draws the three dots in the row text colour, so they show on the light row', () => {
		const { icon } = conversationMenuButton(ACTIVE);
		assert.match(icon.color, /--tk-ink\b|rgb\(21, 23, 27\)/);
	});

	it('marks the button with a light tile while its menu is open', () => {
		const { button } = conversationMenuButton(ACTIVE, 'aria-expanded="true"');
		assert.ok(!SEE_THROUGH.includes(button.backgroundColor), `button background is "${button.backgroundColor}"`);
		assert.match(button.backgroundColor, /--tk-surface3/);
	});
});

describe('Talk: Verificar dispositivos com a câmera desligada', () => {
	const previewRule = () => TALK_STYLESHEET.match(/\.media-settings \.background-preview::before\s*\{([^}]*)\}/)?.[1] ?? '';

	it('draws the Avuz call background behind the avatar instead of the stock theme photo', () => {
		const background = previewRule().match(/url\("?([^")]+)"?\)/)?.[1];
		assert.ok(background, 'no background image in the preview rule');
		assert.doesNotMatch(previewRule(), /--image-background/);
		assert.ok(existsSync(fileURLToPath(new URL(background, STYLESHEET_URL))), `${background} does not exist`);
	});
});
