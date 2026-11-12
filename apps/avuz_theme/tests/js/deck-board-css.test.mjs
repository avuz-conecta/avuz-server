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

const renderColumns = () => {
	const { window } = new JSDOM(`<style>${BOARD_STYLESHEET}</style>
		<div id="content" class="app-deck"><div class="board"><div class="smooth-dnd-container horizontal">
			<div class="stack-draggable-wrapper smooth-dnd-draggable-wrapper">
				<div class="stack">
					<div class="stack__header"><h3 class="stack__title">Lista longa</h3></div>
					<div class="dnd-container smooth-dnd-container vertical"><div class="smooth-dnd-draggable-wrapper"><div class="card">Cartão</div></div></div>
				</div>
			</div>
		</div></div></div>`);
	const style = (selector) => window.getComputedStyle(window.document.querySelector(selector));
	return { column: style('.stack-draggable-wrapper'), list: style('.stack'), cards: style('.dnd-container') };
};

describe('Tarefas: rolagem do quadro', () => {
	const { column, list, cards } = renderColumns();

	it('keeps each list no taller than the board, so the board itself does not scroll down', () => {
		assert.equal(column.maxHeight, '100%');
		assert.equal(list.maxHeight, '100%');
	});

	it('scrolls the cards inside their own list, under a header that stays in place', () => {
		assert.equal(cards.overflowY, 'auto');
		assert.equal(parseFloat(cards.minHeight), 0);
	});

	it('draws a thin, quiet scrollbar on a list', () => {
		assert.equal(cards.scrollbarWidth, 'thin');
		assert.match(cards.scrollbarColor, /transparent/);
	});

	it('leaves the list header out of the scrolling area', () => {
		assert.notEqual(listHeaderOn('stack').position, 'sticky');
	});
});

describe('Tarefas: cabeçalho da lista', () => {
	describe('lista sem cor', () => {
		const header = listHeaderOn('stack');

		it('paints the list colour behind the title', () => {
			assert.ok(!SEE_THROUGH.includes(header.backgroundColor), `header background is "${header.backgroundColor}"`);
			assert.match(header.backgroundColor, /--avuz-list-bg/);
		});
	});

	describe('lista colorida', () => {
		const header = listHeaderOn('stack stack--colored');

		it('paints the tinted list colour behind the title', () => {
			assert.ok(!SEE_THROUGH.includes(header.backgroundColor), `header background is "${header.backgroundColor}"`);
			assert.match(header.backgroundColor, /--stack-color/);
		});
	});
});
