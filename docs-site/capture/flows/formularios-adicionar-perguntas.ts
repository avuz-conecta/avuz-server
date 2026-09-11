import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Pesquisa de satisfação';
const SHORT_ANSWER_QUESTION = 'Qual seu nome?';
const MULTIPLE_CHOICE_QUESTION = 'Como avalia o atendimento?';
const MULTIPLE_CHOICE_OPTIONS = ['Ótimo', 'Bom', 'Ruim'] as const;

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

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/forms`);
  await createForm(page);
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

  const addQuestionButton = page.getByRole('button', { name: 'Adicionar uma pergunta' });
  await addQuestionButton.waitFor({ state: 'visible', timeout: 15000 });
  await pause(600);
}

async function addShortAnswerQuestion(page: Page): Promise<void> {
  const addQuestionButton = page.getByRole('button', { name: 'Adicionar uma pergunta' });
  await moveAndClick(page, addQuestionButton, 500);

  const shortAnswerOption = page.getByRole('menuitem', { name: 'Resposta curta' });
  await shortAnswerOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, shortAnswerOption, 500);

  const titleField = page.getByPlaceholder('Título da pergunta de resposta curta');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, titleField, 300);
  await titleField.fill(SHORT_ANSWER_QUESTION);
  await pause(600);
}

async function addMultipleChoiceQuestion(page: Page): Promise<void> {
  const addQuestionButton = page.getByRole('button', { name: 'Adicionar uma pergunta' });
  await moveAndClick(page, addQuestionButton, 500);

  const multipleChoiceOption = page.getByRole('menuitem', { name: 'Botões de opção' });
  await multipleChoiceOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, multipleChoiceOption, 500);

  const titleField = page.getByPlaceholder('Título da pergunta dos botões de opção');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, titleField, 300);
  await titleField.fill(MULTIPLE_CHOICE_QUESTION);
  await pause(600);

  for (const option of MULTIPLE_CHOICE_OPTIONS) {
    const optionField = page.getByRole('textbox', { name: 'Adicionar uma nova opção de resposta' });
    await moveAndClick(page, optionField, 400);
    await optionField.fill(option);
    const addOptionButton = page.getByRole('button', { name: 'Adicionar uma nova opção de resposta' });
    await addOptionButton.click();
    await pause(500);
  }
}

async function record(page: Page): Promise<readonly Step[]> {
  await openFormEditor(page);
  await addShortAnswerQuestion(page);
  await addMultipleChoiceQuestion(page);
  await pause(1000);

  return [
    { n: 1, text: `Abra o formulário (ex.: **${FORM_TITLE}**) e clique em **Editar**.` },
    { n: 2, text: 'Clique em **Adicionar uma pergunta** e escolha **Resposta curta** para uma pergunta de texto.' },
    { n: 3, text: `Digite o título da pergunta (ex.: **${SHORT_ANSWER_QUESTION}**).` },
    { n: 4, text: 'Clique em **Adicionar uma pergunta** de novo e escolha **Botões de opção** para múltipla escolha.' },
    {
      n: 5,
      text: `Digite o título (ex.: **${MULTIPLE_CHOICE_QUESTION}**) e adicione as opções de resposta (ex.: **${MULTIPLE_CHOICE_OPTIONS.join(', ')}**).`,
    },
    { n: 6, text: 'Tudo é salvo automaticamente conforme você edita o formulário.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'adicionar-perguntas',
  title: 'Como adicionar perguntas',
  description: 'Monte o formulário com perguntas de texto, múltipla escolha e mais.',
  tip: 'Combine tipos de pergunta conforme o que você precisa coletar.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
