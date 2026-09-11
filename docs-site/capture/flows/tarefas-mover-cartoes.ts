import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveTo, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Fluxo de Trabalho';
const SOURCE_LIST = 'A fazer';
const TARGET_LIST = 'Em andamento';
const CARD_TITLE = 'Revisar contrato';

async function createBoardListsAndCard(page: Page): Promise<void> {
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
  const firstListInput = emptyContent.getByPlaceholder('Nome da lista');
  await firstListInput.waitFor({ state: 'visible', timeout: 15000 });
  await firstListInput.fill(SOURCE_LIST);
  await emptyContent.getByRole('button', { name: 'Adicionar lista' }).click();

  const firstStack = page.locator(`[data-cy-stack="${SOURCE_LIST}"]`);
  await firstStack.waitFor({ state: 'visible', timeout: 15000 });

  const stackAddButton = page.locator('#stack-add button');
  const newStackInput = page.locator('#new-stack-input-main');
  await stackAddButton.click();
  await newStackInput.waitFor({ state: 'visible', timeout: 10000 });
  await newStackInput.fill(TARGET_LIST);
  await newStackInput.press('Enter');

  const secondStack = page.locator(`[data-cy-stack="${TARGET_LIST}"]`);
  await secondStack.waitFor({ state: 'visible', timeout: 15000 });

  const addCardButton = firstStack.getByRole('button', { name: 'Adicionar cartão' });
  await addCardButton.click();

  const cardInput = firstStack.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });
  await cardInput.fill(CARD_TITLE);
  await cardInput.press('Enter');

  const card = firstStack.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoardListsAndCard(page);
  return context;
}

async function openBoard(page: Page): Promise<void> {
  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  if (await boardHeading.isVisible().catch(() => false)) return;

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 20000 });
  await boardLink.click();
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });
}

async function dragCardBetweenLists(page: Page): Promise<void> {
  const sourceStack = page.locator(`[data-cy-stack="${SOURCE_LIST}"]`);
  const targetStack = page.locator(`[data-cy-stack="${TARGET_LIST}"]`);
  const card = sourceStack.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });

  const cardBox = await card.boundingBox();
  const targetBox = await targetStack.boundingBox();
  if (!cardBox) throw new Error('dragCardBetweenLists: card has no bounding box (not visible?)');
  if (!targetBox) throw new Error('dragCardBetweenLists: target list has no bounding box (not visible?)');

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.min(cardBox.height, targetBox.height) / 2 + 40;

  await moveTo(page, cardBox);
  await pause(500);
  await page.mouse.down();
  await pause(200);

  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const x = startX + (endX - startX) * progress;
    const y = startY + (endY - startY) * progress;
    await page.mouse.move(x, y, { steps: 5 });
    await pause(120);
  }

  await pause(400);
  await page.mouse.up();
  await pause(800);

  const movedCard = targetStack.locator('.card').filter({ hasText: CARD_TITLE });
  await movedCard.waitFor({ state: 'visible', timeout: 15000 });
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await pause(600);

  await dragCardBetweenLists(page);

  return [
    { n: 1, text: `Abra o painel (ex.: **${BOARD_NAME}**) com o cartão que deseja mover (ex.: **${CARD_TITLE}**) na lista **${SOURCE_LIST}**.` },
    { n: 2, text: `Clique e segure o cartão, depois arraste-o para a lista de destino (ex.: **${TARGET_LIST}**).` },
    { n: 3, text: 'Solte o cartão sobre a lista para posicioná-lo lá.' },
    { n: 4, text: `O cartão agora aparece dentro de **${TARGET_LIST}**, refletindo a nova etapa da tarefa.` },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'mover-cartoes',
  title: 'Como mover cartões entre listas',
  description: 'Arraste um cartão de uma lista para outra conforme a tarefa avança.',
  tip: 'Mover para "Concluído" mostra o progresso do time.',
  order: 5,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
