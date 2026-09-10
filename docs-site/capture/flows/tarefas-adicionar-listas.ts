import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const BOARD_NAME = 'Lançamento do Produto';
const BOARD_COLOR = 'Azul Nextcloud';
const LIST_NAMES = ['A fazer', 'Em andamento', 'Concluído'] as const;

async function createAndOpenBoard(page: Page): Promise<void> {
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
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);

  await createAndOpenBoard(page);

  let frame = 0;

  const emptyContent = page.locator('.empty-content');
  const firstListInput = emptyContent.getByPlaceholder('Nome da lista');
  await firstListInput.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  await firstListInput.fill(LIST_NAMES[0]);
  await emptyContent.getByRole('button', { name: 'Adicionar lista' }).click();

  const firstStack = page.locator(`[data-cy-stack="${LIST_NAMES[0]}"]`);
  await firstStack.waitFor({ state: 'visible', timeout: 15000 });

  const stackAddButton = page.locator('#stack-add button');
  const newStackInput = page.locator('#new-stack-input-main');

  await stackAddButton.click();
  await newStackInput.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await newStackInput.fill(LIST_NAMES[1]);
  await newStackInput.press('Enter');

  const secondStack = page.locator(`[data-cy-stack="${LIST_NAMES[1]}"]`);
  await secondStack.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  await stackAddButton.waitFor({ state: 'visible', timeout: 10000 });
  await stackAddButton.click();
  await newStackInput.waitFor({ state: 'visible', timeout: 10000 });
  await newStackInput.fill(LIST_NAMES[2]);
  await newStackInput.press('Enter');

  const thirdStack = page.locator(`[data-cy-stack="${LIST_NAMES[2]}"]`);
  await thirdStack.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra um painel sem listas (ex.: **${BOARD_NAME}**); o painel mostra o campo **Nome da lista**.` },
    { n: 2, text: `Digite um nome (ex.: **${LIST_NAMES[0]}**) e clique em **Adicionar lista** para criar a primeira lista.` },
    { n: 3, text: `Clique em **Adicionar lista** no topo do painel para criar as próximas listas (ex.: **${LIST_NAMES[1]}**, **${LIST_NAMES[2]}**).` },
    { n: 4, text: 'Cada lista aparece como uma nova coluna no painel, pronta para receber cartões.' },
  ];

  return {
    title: 'Como adicionar listas',
    description: 'Crie colunas (listas) no painel para separar as etapas do trabalho.',
    app: 'tarefas',
    slug: 'adicionar-listas',
    order: 2,
    media: 'adicionar-listas.mp4',
    tip: `Um fluxo comum é usar as listas ${LIST_NAMES[0]}, ${LIST_NAMES[1]} e ${LIST_NAMES[2]}.`,
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
