import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Organização de Evento';
const LIST_NAME = 'A fazer';
const CARD_TITLE = 'Preparar evento';
const CHECKLIST_ITEMS = ['Reservar local', 'Enviar convites', 'Confirmar buffet'] as const;

async function createBoardWithListAndCard(page: Page): Promise<void> {
  const addBoardLink = page.getByRole('link', { name: 'Adicionar painel' });
  await addBoardLink.waitFor({ state: 'visible', timeout: 20000 });
  await addBoardLink.click();

  const nameField = page.getByPlaceholder('Nome do painel');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(BOARD_NAME);
  await page.getByRole('button', { name: 'Salvar painel' }).click();

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 15000 });
  await boardLink.click();

  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });

  const emptyContent = page.locator('.empty-content');
  const listInput = emptyContent.getByPlaceholder('Nome da lista');
  await listInput.waitFor({ state: 'visible', timeout: 15000 });
  await listInput.fill(LIST_NAME);
  await emptyContent.getByRole('button', { name: 'Adicionar lista' }).click();

  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  await list.waitFor({ state: 'visible', timeout: 15000 });

  const addCardButton = list.getByRole('button', { name: 'Adicionar cartão' });
  await addCardButton.click();

  const cardInput = list.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });
  await cardInput.fill(CARD_TITLE);
  await cardInput.press('Enter');

  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoardWithListAndCard(page);
  return context;
}

async function openBoard(page: Page): Promise<void> {
  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  if (await boardHeading.isVisible().catch(() => false)) return;

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 20000 });
  await pause(500);
  await moveAndClick(page, boardLink, 500);
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(800);
}

async function openCardDetail(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, card, 500);

  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: CARD_TITLE });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
  await pause(1000);
}

// The task-list checkbox is a `::before` pseudo-element on the <li> (the real
// <input type="checkbox"> is CSS `display: none`), so it must be clicked at a
// fixed offset within the item's box rather than through the hidden input.
async function clickTaskListCheckbox(page: Page, item: Locator): Promise<void> {
  const box = await item.boundingBox();
  if (!box) throw new Error('clickTaskListCheckbox: checklist item has no bounding box (not visible?)');
  const x = box.x + 9;
  const y = box.y + 10;
  await page.mouse.move(x, y, { steps: 20 });
  await pause(500);
  await page.mouse.click(x, y);
}

async function addChecklist(page: Page): Promise<void> {
  const descriptionEditor = page.locator('.description__text .tiptap.ProseMirror');
  await descriptionEditor.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, descriptionEditor, 500);

  const listsButton = page.locator('[data-text-action-entry="lists"] button');
  await moveAndClick(page, listsButton, 500);

  const taskListOption = page.locator('[data-text-action-entry="task-list"] button');
  await taskListOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(300);
  await moveAndClick(page, taskListOption, 500);
  await pause(400);

  for (let index = 0; index < CHECKLIST_ITEMS.length; index += 1) {
    await page.keyboard.type(CHECKLIST_ITEMS[index], { delay: 40 });
    if (index < CHECKLIST_ITEMS.length - 1) {
      await pause(250);
      await page.keyboard.press('Enter');
      await pause(250);
    }
  }
  await pause(700);

  const firstItem = page.locator('.description__text li.task-list-item').filter({ hasText: CHECKLIST_ITEMS[0] });
  await firstItem.waitFor({ state: 'visible', timeout: 10000 });
  await clickTaskListCheckbox(page, firstItem);

  // Let the description autosave debounce (~2.5s) persist the change before the recording ends.
  await pause(3000);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await openCardDetail(page);
  await addChecklist(page);

  return [
    { n: 1, text: `Abra o cartão (ex.: **${CARD_TITLE}**) e clique no campo **Descrição** para começar a escrever.` },
    { n: 2, text: 'Clique no botão **Listas** na barra de formatação e escolha **Lista de tarefas** para criar uma checklist.' },
    { n: 3, text: `Digite cada subtarefa (ex.: "${CHECKLIST_ITEMS[0]}", "${CHECKLIST_ITEMS[1]}", "${CHECKLIST_ITEMS[2]}") e pressione Enter entre elas para criar novos itens.` },
    { n: 4, text: `Clique na caixa de seleção ao lado de um item (ex.: **${CHECKLIST_ITEMS[0]}**) para marcá-lo como concluído.` },
    { n: 5, text: 'O cartão mostra o progresso da checklist (ex.: 1/3) direto no painel, sem precisar abrir os detalhes.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'checklist-subtarefas',
  title: 'Como usar uma checklist no cartão',
  description: 'Divida uma tarefa em subtarefas com uma checklist marcável dentro do cartão.',
  tip: 'Marque cada item conforme conclui — a barra de progresso do cartão acompanha.',
  order: 8,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
