import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Lançamento do Produto';
const LIST_NAMES = ['A fazer', 'Em andamento', 'Concluído'] as const;

async function createBoard(page: Page): Promise<void> {
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
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoard(page);
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

async function addFirstList(page: Page): Promise<void> {
  const emptyContent = page.locator('.empty-content');
  const firstListInput = emptyContent.getByPlaceholder('Nome da lista');
  await firstListInput.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);

  await firstListInput.fill(LIST_NAMES[0]);
  await pause(400);
  await moveAndClick(page, emptyContent.getByRole('button', { name: 'Adicionar lista' }), 500);

  const firstStack = page.locator(`[data-cy-stack="${LIST_NAMES[0]}"]`);
  await firstStack.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
}

async function addList(page: Page, name: string): Promise<void> {
  const stackAddButton = page.locator('#stack-add button');
  const newStackInput = page.locator('#new-stack-input-main');

  await stackAddButton.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, stackAddButton, 500);
  await newStackInput.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);

  await newStackInput.fill(name);
  await pause(400);
  await newStackInput.press('Enter');

  const stack = page.locator(`[data-cy-stack="${name}"]`);
  await stack.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);

  await addFirstList(page);
  await addList(page, LIST_NAMES[1]);
  await addList(page, LIST_NAMES[2]);

  return [
    { n: 1, text: `Abra um painel sem listas (ex.: **${BOARD_NAME}**); o painel mostra o campo **Nome da lista**.` },
    { n: 2, text: `Digite um nome (ex.: **${LIST_NAMES[0]}**) e clique em **Adicionar lista** para criar a primeira lista.` },
    { n: 3, text: `Clique em **Adicionar lista** no topo do painel para criar as próximas listas (ex.: **${LIST_NAMES[1]}**, **${LIST_NAMES[2]}**).` },
    { n: 4, text: 'Cada lista aparece como uma nova coluna no painel, pronta para receber cartões.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'adicionar-listas',
  title: 'Como adicionar listas',
  description: 'Crie colunas (listas) no painel para separar as etapas do trabalho.',
  tip: `Um fluxo comum é usar as listas ${LIST_NAMES[0]}, ${LIST_NAMES[1]} e ${LIST_NAMES[2]}.`,
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
