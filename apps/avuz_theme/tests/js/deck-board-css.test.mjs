import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const BOARD_STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/deck-board.css', import.meta.url)), 'utf8');
const SEE_THROUGH = ['', 'transparent', 'rgba(0, 0, 0, 0)', 'inherit'];

const renderBoard = (stackClass) => {
	const { window } = new JSDOM(`<style>${BOARD_STYLESHEET}</style>
		<div id="content" class="app-deck"><div class="board"><div class="smooth-dnd-container horizontal">
			<div class="${stackClass}" style="--stack-color: #e9322d">
				<div class="stack__header"><h3 class="stack__title">Lista longa</h3></div>
				<div class="dnd-container"><div class="card">Cartão</div></div>
			</div>
		</div></div></div>`);
	return window;
};
const listHeaderOn = (stackClass) => {
	const window = renderBoard(stackClass);
	return window.getComputedStyle(window.document.querySelector('.stack__header'));
};

describe('Tarefas: cabeçalho da lista ao rolar o quadro', () => {
	describe('lista sem cor', () => {
		const header = listHeaderOn('stack');

		it('stays pinned at the top while cards scroll', () => {
			assert.equal(header.position, 'sticky');
		});

		it('pins flush with the board top, so no card shows above it', () => {
			const window = renderBoard('stack');
			const boardPaddingTop = parseFloat(window.getComputedStyle(window.document.querySelector('.board')).paddingTop);
			const headerTop = parseFloat(window.getComputedStyle(window.document.querySelector('.stack__header')).top);
			assert.ok(boardPaddingTop > 0, 'board has a top padding');
			assert.equal(headerTop, -boardPaddingTop);
		});

		it('hides the cards scrolling under it with the list colour', () => {
			assert.ok(!SEE_THROUGH.includes(header.backgroundColor), `header background is "${header.backgroundColor}"`);
			assert.match(header.backgroundColor, /--avuz-list-bg/);
		});
	});

	describe('lista colorida', () => {
		const header = listHeaderOn('stack stack--colored');

		it('hides the cards scrolling under it with the tinted list colour', () => {
			assert.ok(!SEE_THROUGH.includes(header.backgroundColor), `header background is "${header.backgroundColor}"`);
			assert.match(header.backgroundColor, /--stack-color/);
		});
	});
});
