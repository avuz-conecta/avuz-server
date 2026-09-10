import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const BOARD_NAME = 'Projeto Cliente';
const LIST_NAME = 'A fazer';
const CARD_TITLE = 'Enviar orçamento';
const ASSIGNEE_QUERY = 'Bruno';
const ASSIGNEE_NAME = 'Bruno Lima';
const ASSIGNEE_UID = 'demo.bruno';

async function shareBoardWithAssignee(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Abrir detalhes' }).click();

  const shareSearch = page.getByRole('combobox', { name: 'Compartilhar painel com um usuário, grupo ou equipe…' });
  await shareSearch.waitFor({ state: 'visible', timeout: 10000 });
  await shareSearch.click();
  await shareSearch.fill(ASSIGNEE_QUERY);

  const shareOption = page.getByRole('option').filter({ hasText: ASSIGNEE_UID });
  await shareOption.click({ timeout: 10000 });

  await page.getByRole('button', { name: 'Fechar barra lateral' }).click();
}

async function createBoardListCardAndOpen(page: Page): Promise<void> {
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

  await shareBoardWithAssignee(page);

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
  await card.click();

  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: CARD_TITLE });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);

  await createBoardListCardAndOpen(page);

  let frame = 0;
  await shoot(page, framesDir, frame++);

  const assigneeCombobox = page.getByRole('combobox', { name: 'Atribuir um usuário a este cartão...' });
  await assigneeCombobox.click();
  await assigneeCombobox.fill(ASSIGNEE_QUERY);

  const assigneeOption = page.getByRole('option').filter({ hasText: ASSIGNEE_NAME });
  await assigneeOption.click({ timeout: 10000 });

  const assignedChip = page.getByText(ASSIGNEE_NAME).first();
  await assignedChip.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const dueDateToggle = page.locator('[data-cy-due-date-actions]').getByRole('button', { name: 'Ações' });
  await dueDateToggle.click();

  const nextWeekOption = page.getByText('Semana que vem', { exact: false });
  await nextWeekOption.waitFor({ state: 'visible', timeout: 10000 });
  await nextWeekOption.click();

  const dueDateField = page.locator('[data-cy-due-date-actions]').locator('..').locator('input');
  await dueDateField.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra um cartão (ex.: **${CARD_TITLE}**) para ver seus detalhes.` },
    {
      n: 2,
      text: `No campo **Selecione um usuário para atribuir a este cartão…**, digite o nome da pessoa (ex.: **${ASSIGNEE_QUERY}**) e selecione **${ASSIGNEE_NAME}** na lista.`,
    },
    {
      n: 3,
      text: 'Clique no **+** ao lado de **Data de vencimento** e escolha **Semana que vem** (ou outra opção da lista) para definir o prazo.',
    },
  ];

  return {
    title: 'Como atribuir responsável e prazo',
    description: 'Defina quem faz a tarefa e até quando, direto no cartão.',
    app: 'tarefas',
    slug: 'responsavel-e-prazo',
    order: 4,
    media: 'responsavel-e-prazo.mp4',
    tip: 'Quem é atribuído recebe o cartão em "Meus cartões". A pessoa escolhida precisa já ser integrante do painel.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
