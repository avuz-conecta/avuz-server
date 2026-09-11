import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Inscrição no evento';
const QUESTION_TITLE = 'Nome completo';

let createdFormPath = '';

async function createForm(page: Page): Promise<void> {
  const newFormButton = page.getByRole('button', { name: 'Novo formulário', exact: true });
  await newFormButton.waitFor({ state: 'visible', timeout: 20000 });
  await newFormButton.click();

  const titleField = page.getByPlaceholder('Título do Formulário');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await titleField.fill(FORM_TITLE);

  const descriptionField = page.getByPlaceholder('Descrição (há suporte para formatação usando Markdown)');
  await descriptionField.click();

  await page.waitForURL(/\/apps\/forms\/\w+/, { timeout: 20000 });
  const [, formId] = /\/apps\/forms\/(\w+)/.exec(new URL(page.url()).pathname) ?? [];
  if (!formId) throw new Error(`could not extract form id from URL: ${page.url()}`);
  createdFormPath = `/apps/forms/${formId}`;
}

async function addShortAnswerQuestion(page: Page): Promise<void> {
  const addQuestionButton = page.getByRole('button', { name: 'Adicionar uma pergunta' });
  await addQuestionButton.waitFor({ state: 'visible', timeout: 15000 });
  await addQuestionButton.click();

  const shortAnswerOption = page.getByRole('menuitem', { name: 'Resposta curta' });
  await shortAnswerOption.waitFor({ state: 'visible', timeout: 10000 });
  await shortAnswerOption.click();

  const titleField = page.getByPlaceholder('Título da pergunta de resposta curta');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await titleField.fill(QUESTION_TITLE);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/forms`);
  await createForm(page);
  await addShortAnswerQuestion(page);
  return context;
}

async function openFormEditor(page: Page): Promise<void> {
  if (!createdFormPath) throw new Error('createForm must run (via setup) before openFormEditor');

  // Target the exact form created in setup() by its href — the sidebar list can hold
  // same-titled forms from earlier captures, so matching by title text is ambiguous.
  const formEntry = page.locator(`a[href="${createdFormPath}"]`);
  await formEntry.waitFor({ state: 'visible', timeout: 20000 });
  await pause(500);
  await moveAndClick(page, formEntry, 500);

  const editTab = page.getByText('Editar', { exact: true });
  await editTab.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, editTab, 500);

  const actionsButton = page.getByRole('button', { name: 'Ações', exact: true });
  await actionsButton.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
}

async function makeQuestionRequired(page: Page): Promise<void> {
  const actionsButton = page.getByRole('button', { name: 'Ações', exact: true });
  await moveAndClick(page, actionsButton, 500);

  const requiredToggle = page.getByText('Obrigatório', { exact: true });
  await requiredToggle.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, requiredToggle, 500);
  await pause(500);

  await page.keyboard.press('Escape');
  await pause(1000);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openFormEditor(page);
  await makeQuestionRequired(page);

  return [
    { n: 1, text: `Abra o formulário (ex.: **${FORM_TITLE}**) e clique em **Editar**.` },
    { n: 2, text: `Na pergunta (ex.: **${QUESTION_TITLE}**), clique no menu **Ações**.` },
    { n: 3, text: 'Marque a opção **Obrigatório**.' },
    { n: 4, text: 'Um asterisco (*) vermelho aparece ao lado da pergunta, indicando que ela é obrigatória.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'pergunta-obrigatoria',
  title: 'Como tornar uma pergunta obrigatória',
  description: 'Exija resposta em perguntas essenciais antes de enviar o formulário.',
  tip: 'Perguntas obrigatórias mostram um asterisco (*) para quem responde.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
