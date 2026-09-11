import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Avaliação do evento';
const QUESTION = 'Como você avalia o evento?';
const SUBMITTED_ANSWERS = ['Ótimo, gostei muito', 'Bom, mas pode melhorar', 'Excelente organização'] as const;

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
  // once results load, a second pill-menu (Resumo / Respostas / Baixar / Opções)
  // appears, so this must run before that happens to stay unambiguous.
  const topRespostasTab = page.locator('.pill-menu').getByText('Respostas', { exact: true });
  await topRespostasTab.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, topRespostasTab, 600);

  await page.waitForURL(/\/results$/, { timeout: 15000 });
  await pause(1000);

  const optionsButton = page.getByRole('button', { name: 'Opções' });
  await optionsButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, optionsButton, 600);

  // A single popover element is reused for both the top-level "Opções"
  // menu and the "Baixar" format submenu — only one `role=menu` exists at a
  // time, so scoping to it (rather than `.last()`) is enough to stay unambiguous.
  const menu = page.getByRole('menu');
  const baixarItem = menu.getByRole('menuitem', { name: 'Baixar' });
  await baixarItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, baixarItem, 600);

  const csvItem = menu.getByRole('menuitem', { name: 'CSV', exact: true });
  await csvItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);

  const downloadDir = await mkdtemp(join(tmpdir(), 'avuz-capture-download-'));
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), moveAndClick(page, csvItem, 500)]);
    await download.saveAs(join(downloadDir, download.suggestedFilename()));
    await pause(1000);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }

  return [
    { n: 1, text: `Abra o formulário (ex.: **${FORM_TITLE}**) e clique na aba **Respostas**.` },
    { n: 2, text: 'Clique em **Opções** e depois em **Baixar**.' },
    { n: 3, text: 'Escolha o formato **CSV**: a planilha com todas as respostas é baixada no seu computador.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'exportar-respostas',
  title: 'Como exportar as respostas',
  description: 'Baixe as respostas em planilha (CSV) para analisar fora do sistema.',
  tip: 'Exporte para CSV e abra na sua planilha favorita.',
  order: 6,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
