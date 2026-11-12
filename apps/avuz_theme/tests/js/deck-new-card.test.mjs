import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const NEW_CARD_SCRIPT = readFileSync(fileURLToPath(new URL('../../js/deck-new-card.js', import.meta.url)), 'utf8');
const NEW_CARD_STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/deck-new-card.css', import.meta.url)), 'utf8');
const PRESSED_STYLE_SELECTORS = [...NEW_CARD_STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
	.flatMap((rule) => rule[1].split(','))
	.map((selector) => selector.trim())
	.filter((selector) => selector.includes('[aria-pressed="true"]') && !/\s/.test(selector));
const looksPressed = (chip) => PRESSED_STYLE_SELECTORS.some((selector) => chip.matches(selector));
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

	const weekday = (day) => form().querySelector(`.avuz-nc__weekday[data-day="${day}"]`);
	const dialogOpen = () => document.querySelector('.avuz-nc-overlay') !== null;

	return { window, document, form, control, option, weekday, typeIn, submit, actionsCalled, toasts, dialogOpen };
}

const fieldLabels = (page) => [...page.document.querySelectorAll('.avuz-nc__custom-label')].map((label) => label.textContent.replace(/\s+/g, ' ').trim());

const localToday = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const alertText = (page) => page.document.querySelector('[role="alert"]:not([hidden])')?.textContent ?? '';

async function savedMoney(typed) {
	const page = openNewCard({ fields: [FIELD.amount] });
	page.typeIn(page.control(FIELD.amount), typed);
	await page.submit();
	return page.actionsCalled('setCustomFieldValue').map((payload) => payload.value);
}

describe('Novo cartão', () => {
	describe('duas colunas', () => {
		const page = openNewCard();
		const main = () => page.form().querySelector('.avuz-nc__main');
		const side = () => page.form().querySelector('aside.avuz-nc__side');
		const STYLES = NEW_CARD_STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '');
		const declarationsFor = (selector) => [...STYLES.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter((rule) => rule[1].split(',').some((part) => part.trim() === selector))
			.map((rule) => rule[2].replace(/\s+/g, ' '))
			.join(' ');

		it('writes the card in the main column: description, subtasks and attachments', () => {
			assert.ok(main().querySelector('[data-avuz-rte-host]'), 'description');
			assert.ok(main().querySelector('.avuz-nc__subtask-new'), 'subtasks');
			assert.ok(main().querySelector('.avuz-nc__drop'), 'attachments');
		});

		it('sets the details in a labelled side panel: list, dates, recurrence, labels, people and custom fields', () => {
			assert.equal(side().getAttribute('aria-label'), 'Detalhes do cartão');
			for (const name of ['stack', 'start', 'due', 'recurrence', `custom-${FIELD.contract.id}`]) {
				assert.ok(side().querySelector(`[name="${name}"]`), name);
			}
			assert.ok(side().querySelector('[data-kind="labels"]'), 'labels');
			assert.ok(side().querySelector('[data-kind="people"]'), 'people');
		});

		it('keeps the title above both columns', () => {
			const title = page.form().querySelector('.avuz-nc__title');
			assert.ok(!main().contains(title) && !side().contains(title));
		});

		it('fits the screen: the dialog never grows past it and each column scrolls on its own', () => {
			assert.match(declarationsFor('.avuz-nc.avuz-nc--card'), /max-height: calc\(100vh - /);
			assert.match(declarationsFor('.avuz-nc--card .avuz-nc__main'), /overflow-y: auto;/);
			assert.match(declarationsFor('.avuz-nc--card .avuz-nc__side'), /overflow-y: auto;/);
		});
	});

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

	describe('Recorrência', () => {
		it('sets a weekly recurrence with the chosen weekdays', async () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().elements.recurrence, 'weekly');
			page.weekday('1').click();
			page.weekday('3').click();
			page.typeIn(page.form().elements.recurrenceStart, '2026-11-11');

			await page.submit();

			assert.deepEqual(page.actionsCalled('updateCardRecurrence'), [
				{ card: CREATED_CARD, interval: 'weekly', weekdays: '1,3', start: '2026-11-11', end: null },
			]);
		});

		it('sends a monthly recurrence with its end date and no weekdays', async () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().elements.recurrence, 'monthly');
			page.typeIn(page.form().elements.recurrenceStart, '2026-11-11');
			page.typeIn(page.form().elements.recurrenceEnd, '2027-03-31');

			await page.submit();

			assert.deepEqual(page.actionsCalled('updateCardRecurrence'), [
				{ card: CREATED_CARD, interval: 'monthly', weekdays: null, start: '2026-11-11', end: '2027-03-31' },
			]);
		});

		it('defaults the start to today and hides weekdays for Mensal', () => {
			const page = openNewCard({ fields: [] });

			page.typeIn(page.form().elements.recurrence, 'monthly');

			assert.equal(page.form().elements.recurrenceStart.value, localToday());
			assert.equal(page.weekday('1').closest('[hidden]') !== null, true);
		});

		it('shows the weekdays for Semanal', () => {
			const page = openNewCard({ fields: [] });

			page.typeIn(page.form().elements.recurrence, 'weekly');

			assert.equal(page.weekday('1').closest('[hidden]'), null);
		});

		it('sends no recurrence by default', async () => {
			const page = openNewCard({ fields: [] });

			await page.submit();

			assert.deepEqual(page.actionsCalled('updateCardRecurrence'), []);
		});

		it('blocks an end date before the start', async () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().elements.recurrence, 'daily');
			page.typeIn(page.form().elements.recurrenceStart, '2026-11-20');
			page.typeIn(page.form().elements.recurrenceEnd, '2026-11-10');

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Fim/);
		});
	});

	describe('chips selecionados', () => {
		it('styles a chosen weekday as selected', () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().elements.recurrence, 'weekly');

			page.weekday('1').click();

			assert.deepEqual([looksPressed(page.weekday('1')), looksPressed(page.weekday('2'))], [true, false]);
		});

		it('styles a chosen multi option as selected', () => {
			const page = openNewCard({ fields: [FIELD.areas] });

			page.option(FIELD.areas, 'b').click();

			assert.deepEqual([looksPressed(page.option(FIELD.areas, 'b')), looksPressed(page.option(FIELD.areas, 'a'))], [true, false]);
		});
	});

	describe('depois de criar', () => {
		it('keeps the card when a custom field fails to save', async () => {
			const page = openNewCard({
				fields: [FIELD.contract],
				actions: { setCustomFieldValue: async () => { throw new Error('invalid value for field type'); } },
			});
			page.typeIn(page.control(FIELD.contract), 'C-77');

			await page.submit();

			assert.equal(page.actionsCalled('addCard').length, 1);
			assert.equal(page.dialogOpen(), false);
			assert.equal(page.toasts.length, 1);
			assert.equal(page.toasts[0].options?.type, 'error');
			assert.match(page.toasts[0].message, /Contrato/);
		});

		it('keeps the card when the recurrence fails to save', async () => {
			const page = openNewCard({
				fields: [],
				actions: { updateCardRecurrence: async () => { throw new Error('invalid recurrence interval'); } },
			});
			page.typeIn(page.form().elements.recurrence, 'daily');

			await page.submit();

			assert.equal(page.actionsCalled('addCard').length, 1);
			assert.equal(page.dialogOpen(), false);
			assert.match(page.toasts[0].message, /recorrência/);
		});

		it('keeps the card when the refresh fetch fails', async () => {
			const page = openNewCard({
				fields: [],
				fetchCard: async () => { throw new TypeError('Failed to fetch'); },
			});

			await page.submit();

			assert.equal(page.actionsCalled('addCard').length, 1);
			assert.equal(page.dialogOpen(), false);
			assert.equal(page.toasts.length, 1);
			assert.notEqual(page.toasts[0].options?.type, 'error');
		});

		it('offers a retry when creating the card itself fails', async () => {
			const page = openNewCard({
				fields: [],
				actions: { addCard: async () => { throw new Error('offline'); } },
			});

			await page.submit();

			assert.equal(page.dialogOpen(), true);
			assert.match(alertText(page), /Não foi possível criar o cartão/);
			assert.equal(page.form().querySelector('.avuz-nc__create').disabled, false);
		});
	});

	describe('valores que o navegador não consegue ler', () => {
		it('ignores a second Ctrl+Enter while the card is being created', async () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().querySelector('.avuz-nc__title'), 'Revisar contrato');

			page.form().requestSubmit();
			page.form().requestSubmit();
			await new Promise((resolve) => page.window.setTimeout(resolve, 50));

			assert.equal(page.actionsCalled('addCard').length, 1);
		});

		it('blocks a number field the browser cannot read and names it', async () => {
			const page = openNewCard({ fields: [FIELD.hours] });
			Object.defineProperty(page.control(FIELD.hours), 'validity', { value: { badInput: true } });

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Valor inválido em: Horas/);
			assert.equal(page.document.activeElement, page.control(FIELD.hours));
		});

		it('blocks a custom date with a five-digit year', async () => {
			const page = openNewCard({ fields: [FIELD.delivery] });
			page.typeIn(page.control(FIELD.delivery), '10000-01-01');

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Valor inválido em: Entrega/);
		});

		it('blocks a recurrence end with a five-digit year', async () => {
			const page = openNewCard({ fields: [] });
			page.typeIn(page.form().elements.recurrence, 'daily');
			page.typeIn(page.form().elements.recurrenceStart, '2026-11-11');
			page.typeIn(page.form().elements.recurrenceEnd, '10000-01-01');

			await page.submit();

			assert.deepEqual(page.actionsCalled('addCard'), []);
			assert.match(alertText(page), /Data inválida na recorrência/);
		});
	});
});
