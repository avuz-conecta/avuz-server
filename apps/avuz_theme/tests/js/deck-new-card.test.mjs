import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const NEW_CARD_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/deck-new-card.js', import.meta.url)), 'utf8');
const CREATED_CARD = { id: 42 };
const SETTLE_ROUNDS = 20;

const FIELD = {
	contract: { id: 11, title: 'Contrato', type: 'text', required: true },
	hours: { id: 12, title: 'Horas', type: 'number', required: false },
	amount: { id: 13, title: 'Valor', type: 'money', required: false },
	delivery: { id: 14, title: 'Entrega', type: 'date', required: false },
	priority: { id: 15, title: 'Prioridade', type: 'dropdown', required: false, options: [{ id: 'a', label: 'Alta' }, { id: 'b', label: 'Baixa' }] },
	areas: { id: 16, title: 'Áreas', type: 'multi', required: false, options: [{ id: 'a', label: 'Jurídico' }, { id: 'b', label: 'Fiscal' }, { id: 'c', label: 'TI' }] },
	billed: { id: 17, title: 'Faturado', type: 'checkbox', required: false },
};
const BOARD_FIELDS = Object.values(FIELD);

/**
 * A Deck board page with one list, the "Novo cartão" script loaded and its
 * dialog opened from the list's "+" button. `actions` overrides Deck store
 * actions by name; every dispatch is recorded in `dispatched`.
 */
function openNewCard({ fields = BOARD_FIELDS, actions = {}, fetchCard } = {}) {
	const dom = new JSDOM(`<!doctype html><html><body id="body-user">
		<div class="app-deck"><div class="stack__header"><span class="stack-host"><button data-cy="action:add-card">+</button></span></div></div>
	</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://conecta.example/apps/deck/board/1' });
	const { window } = dom;
	const { document } = window;
	const dispatched = [];
	const toasts = [];

	const store = {
		state: { currentBoard: { id: 1 } },
		getters: {
			stacksByBoard: () => [{ id: 1, title: 'A fazer' }],
			currentBoardLabels: [],
			assignables: [],
			currentBoardCustomFields: fields,
		},
		commit() {},
		async dispatch(name, payload) {
			dispatched.push({ name, payload });
			if (actions[name]) {
				return actions[name](payload);
			}
			return name === 'addCard' ? CREATED_CARD : {};
		},
	};
	document.querySelector('.app-deck').__vue__ = { $store: store };
	document.querySelector('.stack-host').__vue__ = { stack: { id: 1 }, clickAddCard() {} };
	window.OC = {
		generateUrl: (path) => path,
		requestToken: 'token',
		Notification: { showTemporary: (message, options) => toasts.push({ message, options }) },
	};
	window.fetch = fetchCard ?? (async () => ({ ok: true, json: async () => CREATED_CARD }));

	window.eval(NEW_CARD_SCRIPT);
	document.querySelector('[data-cy="action:add-card"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 }));

	const form = () => document.querySelector('form.avuz-nc');
	const control = (field) => form().elements[`custom-${field.id}`];
	const option = (field, optionId) => form().querySelector(`.avuz-nc__option[data-field="${field.id}"][data-id="${optionId}"]`);
	const settle = async () => {
		for (let round = 0; round < SETTLE_ROUNDS; round++) {
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		}
	};
	const typeIn = (input, value) => {
		input.value = value;
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		input.dispatchEvent(new window.Event('change', { bubbles: true }));
	};
	const submit = async (title = 'Revisar contrato') => {
		await settle(); // the dialog focuses its title once it opens
		typeIn(form().querySelector('.avuz-nc__title'), title);
		form().requestSubmit();
		await settle();
	};
	// Payloads are built inside the page's realm: compare them as plain data
	const actionsCalled = (name) => dispatched.filter((call) => call.name === name).map((call) => JSON.parse(JSON.stringify(call.payload)));

	return { window, document, form, control, option, typeIn, submit, actionsCalled, toasts };
}

const fieldLabels = (page) => [...page.document.querySelectorAll('.avuz-nc__custom-label')].map((label) => label.textContent.replace(/\s+/g, ' ').trim());

const alertText = (page) => page.document.querySelector('[role="alert"]:not([hidden])')?.textContent ?? '';

async function savedMoney(typed) {
	const page = openNewCard({ fields: [FIELD.amount] });
	page.typeIn(page.control(FIELD.amount), typed);
	await page.submit();
	return page.actionsCalled('setCustomFieldValue').map((payload) => payload.value);
}

describe('Novo cartão', () => {
	describe('Campos complementares', () => {
		it('lists the board fields in order, without checkbox fields', () => {
			const page = openNewCard();

			assert.deepEqual(fieldLabels(page), ['Contrato obrigatório', 'Horas', 'Valor', 'Entrega', 'Prioridade', 'Áreas']);
		});

		it('shows no section when the board has no fields', () => {
			const page = openNewCard({ fields: [] });

			assert.equal(page.document.querySelector('.avuz-nc__customs'), null);
		});

		it('shows no section when the board only has checkbox fields', () => {
			const page = openNewCard({ fields: [FIELD.billed] });

			assert.equal(page.document.querySelector('.avuz-nc__customs'), null);
		});

		it('blocks creating while a required field is empty and names it', async () => {
			const page = openNewCard();

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Contrato/);
			assert.equal(page.document.activeElement, page.control(FIELD.contract));
		});

		it('blocks a required multi field with nothing selected', async () => {
			const page = openNewCard({ fields: [{ ...FIELD.areas, required: true }] });

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Áreas/);
		});

		it('creates the card once a required field is filled', async () => {
			const page = openNewCard({ fields: [FIELD.contract] });
			page.typeIn(page.control(FIELD.contract), 'C-77');

			await page.submit();

			assert.equal(page.actionsCalled('addCard').length, 1);
		});

		it('saves the filled fields after creating the card', async () => {
			const page = openNewCard();
			page.typeIn(page.control(FIELD.contract), ' C-77 ');
			page.typeIn(page.control(FIELD.hours), '12.5');
			page.typeIn(page.control(FIELD.amount), '1.234,56');
			page.typeIn(page.control(FIELD.delivery), '2026-11-20');
			page.typeIn(page.control(FIELD.priority), 'b');
			page.option(FIELD.areas, 'c').click();
			page.option(FIELD.areas, 'a').click();

			await page.submit();

			assert.deepEqual(page.actionsCalled('setCustomFieldValue'), [
				{ card: CREATED_CARD, fieldId: FIELD.contract.id, value: 'C-77' },
				{ card: CREATED_CARD, fieldId: FIELD.hours.id, value: '12.5' },
				{ card: CREATED_CARD, fieldId: FIELD.amount.id, value: '1234.56' },
				{ card: CREATED_CARD, fieldId: FIELD.delivery.id, value: '2026-11-20' },
				{ card: CREATED_CARD, fieldId: FIELD.priority.id, value: 'b' },
				{ card: CREATED_CARD, fieldId: FIELD.areas.id, value: '["a","c"]' },
			]);
		});

		it('does not send empty optional fields', async () => {
			const page = openNewCard();
			page.typeIn(page.control(FIELD.contract), 'C-77');

			await page.submit();

			assert.deepEqual(page.actionsCalled('setCustomFieldValue').map((payload) => payload.fieldId), [FIELD.contract.id]);
		});

		it('unselects a multi option pressed twice', async () => {
			const page = openNewCard({ fields: [FIELD.areas] });
			page.option(FIELD.areas, 'b').click();
			page.option(FIELD.areas, 'b').click();

			await page.submit();

			assert.deepEqual(page.actionsCalled('setCustomFieldValue'), []);
		});

		describe('reads money typed pt-BR style', () => {
			const CASES = [
				['1.234,56', ['1234.56']],
				['10', ['10']],
				['R$ 5,5', ['5.5']],
				['abc', []],
				['', []],
			];
			for (const [typed, expected] of CASES) {
				it(`saves "${typed}" as ${JSON.stringify(expected)}`, async () => {
					assert.deepEqual(await savedMoney(typed), expected);
				});
			}
		});
	});
});
