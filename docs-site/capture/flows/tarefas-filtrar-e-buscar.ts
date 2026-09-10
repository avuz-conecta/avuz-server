import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Backlog do Produto';
const LIST_NAME = 'A fazer';
const CARD_TITLES = ['Corrigir login', 'Melhorar busca', 'Nova tela de relatórios', 'Ajustar cores'] as const;
const TARGET_CARD = CARD_TITLES[0];
// Default tag every new board ships with (BoardService::create) — no need to create one.
const LABEL_NAME = 'Ação necessária';
const ASSIGNEE_QUERY = 'Ana';
const ASSIGNEE_NAME = 'Ana Souza';

async function createBoardAndList(page: Page): Promise<void> {
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

async function createCards(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const addCardButton = list.getByRole('button', { name: 'Adicionar cartão' });
  await addCardButton.click();

  const cardInput = list.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });

  for (const title of CARD_TITLES) {
    await cardInput.fill(title);
    await cardInput.press('Enter');
    const card = list.locator('.card').filter({ hasText: title });
    await card.waitFor({ state: 'visible', timeout: 15000 });
  }
}

async function openTargetCard(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const card = list.locator('.card').filter({ hasText: TARGET_CARD });
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.click();

  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: TARGET_CARD });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
}

async function labelAndAssignTargetCard(page: Page): Promise<void> {
  const labelCombobox = page.getByRole('combobox', { name: 'Atribuir uma etiqueta a este cartão...' });
  await labelCombobox.click();
  const labelOption = page.getByRole('option').filter({ hasText: LABEL_NAME });
  await labelOption.waitFor({ state: 'visible', timeout: 10000 });
  await labelOption.click();
  const appliedLabel = page.locator('.vs__selected').filter({ hasText: LABEL_NAME });
  await appliedLabel.waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.press('Escape');

  const assigneeCombobox = page.getByRole('combobox', { name: 'Atribuir um usuário a este cartão...' });
  await assigneeCombobox.click();
  await assigneeCombobox.fill(ASSIGNEE_QUERY);
  const assigneeOption = page.getByRole('option').filter({ hasText: ASSIGNEE_NAME });
  await assigneeOption.waitFor({ state: 'visible', timeout: 10000 });
  await assigneeOption.click();
  const assignedChip = page.getByText(ASSIGNEE_NAME).first();
  await assignedChip.waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.press('Escape');
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoardAndList(page);
  await createCards(page);
  await openTargetCard(page);
  await labelAndAssignTargetCard(page);
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

async function openFilterPanel(page: Page): Promise<void> {
  const filterButton = page.getByRole('button', { name: 'Aplicar filtro' });
  await filterButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(page, filterButton, 500);

  const tagHeading = page.getByRole('heading', { name: 'Filtrar por etiqueta' });
  await tagHeading.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
}

async function narrowListToTargetCard(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);

  // The native checkboxes are visually hidden (styled via their <label>), so
  // click the label — it toggles the checkbox through its `for` attribute
  // and is the only part actually in the viewport.
  const labelCheckboxLabel = page.locator('.filter--item label').filter({ hasText: LABEL_NAME });
  await moveAndClick(page, labelCheckboxLabel, 500);
  await pause(700);

  const userCheckboxLabel = page.locator('.filter--item label').filter({ hasText: ASSIGNEE_NAME });
  await moveAndClick(page, userCheckboxLabel, 500);
  await pause(700);

  const remainingCard = list.locator('.card').filter({ hasText: TARGET_CARD });
  await remainingCard.waitFor({ state: 'visible', timeout: 10000 });
  const otherCard = list.locator('.card').filter({ hasText: CARD_TITLES[1] });
  await otherCard.waitFor({ state: 'hidden', timeout: 10000 });
  await pause(900);
}

async function clearFilter(page: Page): Promise<void> {
  const clearButton = page.getByRole('button', { name: 'Limpar filtro' });
  await moveAndClick(page, clearButton, 500);

  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const otherCard = list.locator('.card').filter({ hasText: CARD_TITLES[1] });
  await otherCard.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await openFilterPanel(page);
  await narrowListToTargetCard(page);
  await clearFilter(page);

  return [
    {
      n: 1,
      text: `Abra o painel (ex.: **${BOARD_NAME}**) com vários cartões na lista **${LIST_NAME}** (ex.: **${TARGET_CARD}**, **${CARD_TITLES[1]}**, **${CARD_TITLES[2]}**, **${CARD_TITLES[3]}**).`,
    },
    { n: 2, text: 'Clique no ícone de filtro, no canto superior direito do painel, para abrir as opções de filtro.' },
    {
      n: 3,
      text: `Em **Filtrar por etiqueta**, marque **${LABEL_NAME}**: só os cartões com essa etiqueta continuam visíveis.`,
    },
    {
      n: 4,
      text: `Em **Filtrar por usuário atribuído**, marque o responsável (ex.: **${ASSIGNEE_NAME}**) para combinar os filtros e isolar ainda mais os cartões — só **${TARGET_CARD}** atende às duas condições.`,
    },
    { n: 5, text: 'Clique em **Limpar filtro** para remover os filtros e ver novamente todos os cartões da lista.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'filtrar-e-buscar',
  title: 'Como filtrar cartões',
  description: 'Encontre cartões rapidamente filtrando por etiqueta, responsável ou prazo.',
  tip: 'Combine filtros para focar só no que importa agora.',
  order: 9,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
