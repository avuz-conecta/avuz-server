import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Planejamento Q3';
const ASSIGNEE_QUERY = 'Bruno';
const ASSIGNEE_UID = 'demo.bruno';
const ASSIGNEE_NAME = 'Bruno Lima';

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

async function openShareTab(page: Page): Promise<void> {
  const detailsButton = page.getByRole('button', { name: 'Abrir detalhes' });
  await detailsButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(page, detailsButton, 500);

  const shareTab = page.getByRole('tab', { name: 'Compartilhando' });
  await shareTab.waitFor({ state: 'visible', timeout: 10000 });
  await pause(300);
  await moveAndClick(page, shareTab, 500);
  await pause(500);
}

async function shareBoardWithAssignee(page: Page): Promise<void> {
  const shareSearch = page.getByRole('combobox', { name: 'Compartilhar painel com um usuário, grupo ou equipe…' });
  await shareSearch.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, shareSearch, 400);
  await shareSearch.fill(ASSIGNEE_QUERY);
  await pause(700);

  const shareOption = page.getByRole('option').filter({ hasText: ASSIGNEE_UID });
  await shareOption.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, shareOption, 500);

  const sharedRow = page.getByRole('listitem').filter({ hasText: ASSIGNEE_NAME });
  await sharedRow.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);
}

async function grantEditPermission(page: Page): Promise<void> {
  const sharedRow = page.getByRole('listitem').filter({ hasText: ASSIGNEE_NAME });
  const editLabel = sharedRow.locator('label').filter({ hasText: 'Pode editar' });
  await editLabel.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, editLabel, 500);
  await pause(800);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await openShareTab(page);
  await shareBoardWithAssignee(page);
  await grantEditPermission(page);

  return [
    { n: 1, text: `Abra o painel (ex.: **${BOARD_NAME}**) e clique em **Abrir detalhes**.` },
    { n: 2, text: 'Na barra lateral, abra a aba **Compartilhando**.' },
    {
      n: 3,
      text: `No campo **Compartilhar painel com um usuário, grupo ou equipe…**, digite o nome da pessoa (ex.: **${ASSIGNEE_QUERY}**) e selecione **${ASSIGNEE_NAME}** na lista.`,
    },
    { n: 4, text: `**${ASSIGNEE_NAME}** aparece na lista de compartilhamento. Marque **Pode editar** para permitir que ela altere o painel.` },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'compartilhar-painel',
  title: 'Como compartilhar um painel',
  description: 'Convide colegas para colaborar no mesmo painel de tarefas.',
  tip: 'Defina se cada pessoa pode ver, editar ou gerenciar o painel.',
  order: 10,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
