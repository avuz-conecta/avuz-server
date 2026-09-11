import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Feedback do curso';
const QUESTION = 'O que você achou?';
const SUBMITTED_ANSWERS = ['Excelente!', 'Muito bom', 'Gostei'] as const;

let createdFormPath = '';

async function createFormWithQuestion(page: Page): Promise<void> {
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

  // A freshly created form opens straight into the editor, so the question
  // can be added right here without a separate "Editar" tab click.
  const addQuestionButton = page.getByRole('button', { name: 'Adicionar uma pergunta' });
  await addQuestionButton.waitFor({ state: 'visible', timeout: 15000 });
  await addQuestionButton.click();

  const shortAnswerOption = page.getByRole('menuitem', { name: 'Resposta curta' });
  await shortAnswerOption.waitFor({ state: 'visible', timeout: 10000 });
  await shortAnswerOption.click();

  const questionTitleField = page.getByPlaceholder('Título da pergunta de resposta curta');
  await questionTitleField.waitFor({ state: 'visible', timeout: 10000 });
  await questionTitleField.fill(QUESTION);
}

async function getPublicFormUrl(page: Page): Promise<string> {
  const shareButton = page.getByText('Compartilhar', { exact: true });
  await shareButton.waitFor({ state: 'visible', timeout: 15000 });
  await shareButton.click();

  const sidebar = page.getByRole('complementary');
  const addLinkButton = sidebar.getByRole('button', { name: 'Adicionar link' });
  await addLinkButton.waitFor({ state: 'visible', timeout: 15000 });
  await addLinkButton.click();

  // The anchor's href only gets its real /apps/forms/s/<hash> value once the
  // link-creation request round-trips — waitFor({state: 'visible'}) alone can
  // observe a stale href, so poll for the actual public-share path shape.
  const copyLinkButton = sidebar.getByRole('link', { name: 'Copiar para área de transferência' }).first();
  await copyLinkButton.waitFor({ state: 'visible', timeout: 10000 });
  let href = await copyLinkButton.getAttribute('href');
  const deadline = Date.now() + 10000;
  while ((!href || !href.includes('/apps/forms/s/')) && Date.now() < deadline) {
    await pause(300);
    href = await copyLinkButton.getAttribute('href');
  }
  if (!href || !href.includes('/apps/forms/s/')) throw new Error(`public form link never resolved, got: ${href}`);
  return href.startsWith('http') ? href : `${CONFIG.stagingUrl}${href}`;
}

async function submitPublicResponse(browser: Browser, publicUrl: string, answer: string): Promise<void> {
  // Anonymous context — a real respondent never has demo.ana's session.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(publicUrl);

  const answerField = page.getByRole('textbox').first();
  await answerField.waitFor({ state: 'visible', timeout: 15000 });
  await answerField.fill(answer);

  const submitButton = page.getByRole('button', { name: 'Enviar', exact: true });
  await submitButton.click();
  await page.waitForTimeout(500);

  await context.close();
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/forms`);
  await createFormWithQuestion(page);

  const publicUrl = await getPublicFormUrl(page);
  for (const answer of SUBMITTED_ANSWERS) {
    await submitPublicResponse(browser, publicUrl, answer);
  }

  return context;
}

async function openCreatedForm(page: Page): Promise<void> {
  if (!createdFormPath) throw new Error('createFormWithQuestion must run (via setup) before openCreatedForm');

  // Target the exact form created in setup() by its href — the sidebar list can hold
  // same-titled forms from earlier captures, so matching by title text is ambiguous.
  const formEntry = page.locator(`a[href="${createdFormPath}"]`);
  await formEntry.waitFor({ state: 'visible', timeout: 20000 });
  await pause(500);
  await moveAndClick(page, formEntry, 500);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openCreatedForm(page);

  // The "Visualizar / Editar / Respostas" switcher is a single pill-menu here —
  // once results load, a second pill-menu (Resumo / Respostas) appears, so this
  // must run before that happens to stay unambiguous.
  const topRespostasTab = page.locator('.pill-menu').getByText('Respostas', { exact: true });
  await topRespostasTab.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, topRespostasTab, 600);

  await page.waitForURL(/\/results$/, { timeout: 15000 });
  await pause(800);

  // Now two pill-menus exist: the top switcher (index 0) and the
  // Resumo/Respostas view-mode toggle (index 1).
  const resultsViewSwitcher = page.locator('.pill-menu').nth(1);
  const summaryTab = resultsViewSwitcher.getByText('Resumo', { exact: true });
  await summaryTab.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, summaryTab, 700);
  await pause(1200);

  const individualTab = resultsViewSwitcher.getByText('Respostas', { exact: true });
  await individualTab.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, individualTab, 700);
  await pause(1400);

  return [
    { n: 1, text: `Abra o formulário (ex.: **${FORM_TITLE}**) e clique na aba **Respostas**.` },
    { n: 2, text: 'Em **Resumo**, veja quantas respostas chegaram e um resumo geral por pergunta.' },
    { n: 3, text: 'Clique em **Respostas** para ver cada resposta individual, com data e hora de envio.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'ver-respostas',
  title: 'Como ver as respostas',
  description: 'Acompanhe quem respondeu e veja um resumo dos resultados.',
  tip: 'A aba de respostas mostra um resumo geral e cada resposta individual.',
  order: 5,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
