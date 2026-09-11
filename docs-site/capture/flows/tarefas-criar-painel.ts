import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Projeto Marketing';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const addBoardLink = page.getByRole('link', { name: 'Adicionar painel' });
  await addBoardLink.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, addBoardLink, 500);

  const nameField = page.getByPlaceholder('Nome do painel');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);

  const colorButton = page.locator('.board-create button.icon-colorpicker');
  await moveAndClick(page, colorButton, 500);

  const colorDialog = page.getByRole('dialog', { name: 'Seletor de cores' });
  await colorDialog.waitFor({ state: 'visible', timeout: 10000 });
  await pause(600);

  const colorSwatch = colorDialog.locator('label.color-picker__simple-color-circle').first();
  await moveAndClick(page, colorSwatch, 500);

  const chooseButton = colorDialog.getByRole('button', { name: 'Escolher' });
  await moveAndClick(page, chooseButton, 500);

  await pause(400);
  await nameField.fill(BOARD_NAME);
  await pause(600);

  const saveButton = page.getByRole('button', { name: 'Salvar painel' });
  await moveAndClick(page, saveButton, 500);

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 15000 });
  await pause(500);
  await moveAndClick(page, boardLink, 500);

  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra o **Tarefas** e clique em **Adicionar painel** no menu lateral.' },
    { n: 2, text: 'Escolha uma cor para o painel e clique em **Escolher**.' },
    { n: 3, text: `Digite um nome para o painel (ex.: **${BOARD_NAME}**) e confirme em **Salvar painel**.` },
    { n: 4, text: 'O painel é criado na hora e abre pronto para receber listas e cartões.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'criar-painel',
  title: 'Como criar um painel',
  description: 'Crie um painel para organizar tarefas de um projeto ou equipe.',
  tip: 'Use um painel por projeto ou por equipe para manter as tarefas organizadas.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
