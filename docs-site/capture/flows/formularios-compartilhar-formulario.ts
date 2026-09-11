import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Pesquisa de opinião';
const QUESTION = 'O que você achou do nosso atendimento?';

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

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/forms`);
  await createFormWithQuestion(page);
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
  // Clipboard permissions apply per-context, so they must be granted on the
  // recorded context itself (the unrecorded setup context is already closed).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await openCreatedForm(page);

  const shareButton = page.getByText('Compartilhar', { exact: true });
  await shareButton.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, shareButton, 600);

  const sidebar = page.getByRole('complementary');
  const addLinkButton = sidebar.getByRole('button', { name: 'Adicionar link' });
  await addLinkButton.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
  await moveAndClick(page, addLinkButton, 600);

  // The public link's href carries the real staging host — mask it before it
  // can appear in any recorded frame (tooltip, hover state, etc.).
  const copyLinkButton = sidebar.getByRole('link', { name: 'Copiar para área de transferência' }).first();
  await copyLinkButton.waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1000);

  await moveAndClick(page, copyLinkButton, 600);
  await maskRealHost(page);
  await pause(1200);

  await maskRealHost(page);
  await pause(800);

  return [
    { n: 1, text: `Abra o formulário (ex.: **${FORM_TITLE}**) e clique em **Compartilhar**.` },
    { n: 2, text: 'Na aba **Compartilhamento**, clique no **+** ao lado de **Compartilhar link** para gerar um link público.' },
    { n: 3, text: 'O link aparece na lista. Clique em **Copiar para área de transferência** para copiar o endereço.' },
    { n: 4, text: 'Envie o link copiado (e-mail, mensagem) — qualquer pessoa com ele pode abrir o formulário e responder.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'compartilhar-formulario',
  title: 'Como compartilhar um formulário',
  description: 'Gere um link para enviar o formulário e coletar respostas.',
  tip: 'Qualquer pessoa com o link pode responder, sem precisar de conta (se você permitir).',
  order: 4,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
