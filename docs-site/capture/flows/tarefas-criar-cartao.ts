import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Sprint de Vendas';
const LIST_NAME = 'A fazer';
const CARD_TITLE = 'Preparar proposta comercial';

async function createBoardWithList(page: Page): Promise<void> {
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
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoardWithList(page);
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

async function addCard(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  await list.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);

  const addCardButton = list.getByRole('button', { name: 'Adicionar cartão' });
  await moveAndClick(page, addCardButton, 500);

  const cardInput = list.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);

  await cardInput.fill(CARD_TITLE);
  await pause(400);
  await cardInput.press('Enter');

  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
}

async function openCardDetail(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await moveAndClick(page, card, 500);

  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: CARD_TITLE });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
  await pause(1000);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await addCard(page);
  await openCardDetail(page);

  return [
    { n: 1, text: `Abra um painel com listas (ex.: **${BOARD_NAME}**) e clique em **Adicionar cartão** no topo da lista (ex.: **${LIST_NAME}**).` },
    { n: 2, text: `Digite o título do cartão (ex.: **${CARD_TITLE}**) no campo **Nome do cartão**.` },
    { n: 3, text: 'Pressione **Enter** para criar o cartão; ele aparece na hora dentro da lista.' },
    { n: 4, text: 'Clique no cartão para abrir seus detalhes.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'criar-cartao',
  title: 'Como criar um cartão',
  description: 'Adicione cartões a uma lista — cada cartão é uma tarefa.',
  tip: 'Clique no cartão para adicionar descrição, prazo e responsável.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
