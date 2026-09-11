import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Campanha de Marketing';
const LIST_NAME = 'A fazer';
const CARD_TITLE = 'Criar peças gráficas';
const LABEL_NAME = 'Ação necessária';

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

async function applyLabel(page: Page): Promise<void> {
  const labelCombobox = page.getByRole('combobox', { name: 'Atribuir uma etiqueta a este cartão...' });
  await moveAndClick(page, labelCombobox, 500);
  await pause(500);

  const labelOption = page.getByRole('option').filter({ hasText: LABEL_NAME });
  await labelOption.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, labelOption, 500);

  const appliedLabel = page.locator('.vs__selected').filter({ hasText: LABEL_NAME });
  await appliedLabel.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);

  // Close the still-open (multi-select) dropdown on a neutral heading, leaving the applied label visible.
  await moveAndClick(page, page.getByRole('heading', { name: 'Detalhes do cartão' }), 400);
  await pause(600);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await openCardDetail(page);
  await applyLabel(page);

  return [
    { n: 1, text: `Abra o cartão (ex.: **${CARD_TITLE}**) para ver seus detalhes.` },
    { n: 2, text: 'Clique no campo **Selecionar ou criar uma etiqueta…** para ver as etiquetas disponíveis.' },
    { n: 3, text: `Selecione uma etiqueta da lista (ex.: **${LABEL_NAME}**) para aplicá-la ao cartão.` },
    { n: 4, text: 'A etiqueta colorida aparece no cartão, ajudando a identificá-lo rapidamente no painel.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'etiquetas',
  title: 'Como usar etiquetas',
  description: 'Marque cartões com etiquetas coloridas para agrupar e filtrar tarefas.',
  tip: 'Crie suas próprias etiquetas nas configurações do painel.',
  order: 6,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
