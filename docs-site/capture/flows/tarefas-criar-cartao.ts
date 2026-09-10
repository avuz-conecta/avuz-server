import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const BOARD_NAME = 'Sprint de Vendas';
const BOARD_COLOR = 'Azul Nextcloud';
const LIST_NAME = 'A fazer';
const CARD_TITLE = 'Preparar proposta comercial';

async function createBoardWithList(page: Page): Promise<void> {
  const addBoardLink = page.getByRole('link', { name: 'Adicionar painel' });
  await addBoardLink.waitFor({ state: 'visible', timeout: 20000 });
  await addBoardLink.click();

  const nameField = page.getByPlaceholder('Nome do painel');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });

  const colorButton = page.locator('.board-create button.icon-colorpicker');
  await colorButton.click();
  const colorDialog = page.getByRole('dialog', { name: 'Seletor de cores' });
  await colorDialog.waitFor({ state: 'visible', timeout: 10000 });
  const colorSwatch = colorDialog.locator(`label.color-picker__simple-color-circle:has(input[aria-label="${BOARD_COLOR}"])`);
  await colorSwatch.click();
  await colorDialog.getByRole('button', { name: 'Escolher' }).click();

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

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);

  await createBoardWithList(page);

  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  let frame = 0;

  const addCardButton = list.getByRole('button', { name: 'Adicionar cartão' });
  await addCardButton.click();

  const cardInput = list.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await cardInput.fill(CARD_TITLE);
  await shoot(page, framesDir, frame++);

  await cardInput.press('Enter');

  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  await card.click();
  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: CARD_TITLE });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra um painel com listas (ex.: **${BOARD_NAME}**) e clique em **Adicionar cartão** no topo da lista (ex.: **${LIST_NAME}**).` },
    { n: 2, text: `Digite o título do cartão (ex.: **${CARD_TITLE}**) no campo **Nome do cartão**.` },
    { n: 3, text: 'Pressione **Enter** para criar o cartão; ele aparece na hora dentro da lista.' },
    { n: 4, text: 'Clique no cartão para abrir seus detalhes.' },
  ];

  return {
    title: 'Como criar um cartão',
    description: 'Adicione cartões a uma lista — cada cartão é uma tarefa.',
    app: 'tarefas',
    slug: 'criar-cartao',
    order: 3,
    media: 'criar-cartao.mp4',
    tip: 'Clique no cartão para adicionar descrição, prazo e responsável.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
