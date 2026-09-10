import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const BOARD_NAME = 'Projeto Marketing';
const BOARD_COLOR = 'Azul Nextcloud';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);

  const addBoardLink = page.getByRole('link', { name: 'Adicionar painel' });
  await addBoardLink.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await addBoardLink.click();
  const nameField = page.getByPlaceholder('Nome do painel');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });

  const colorButton = page.locator('.board-create button.icon-colorpicker');
  await colorButton.click();
  const colorDialog = page.getByRole('dialog', { name: 'Seletor de cores' });
  await colorDialog.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const colorSwatch = colorDialog.locator(`label.color-picker__simple-color-circle:has(input[aria-label="${BOARD_COLOR}"])`);
  await colorSwatch.click();
  await colorDialog.getByRole('button', { name: 'Escolher' }).click();

  await nameField.fill(BOARD_NAME);
  await shoot(page, framesDir, frame++);

  await page.getByRole('button', { name: 'Salvar painel' }).click();

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 15000 });
  await boardLink.click();

  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: 'Abra o **Tarefas** e clique em **Adicionar painel** no menu lateral.' },
    { n: 2, text: 'Escolha uma cor para o painel e clique em **Escolher**.' },
    { n: 3, text: `Digite um nome para o painel (ex.: **${BOARD_NAME}**) e confirme em **Salvar painel**.` },
    { n: 4, text: 'O painel é criado na hora e abre pronto para receber listas e cartões.' },
  ];

  return {
    title: 'Como criar um painel',
    description: 'Crie um painel para organizar tarefas de um projeto ou equipe.',
    app: 'tarefas',
    slug: 'criar-painel',
    order: 1,
    media: 'criar-painel.mp4',
    tip: 'Use um painel por projeto ou por equipe para manter as tarefas organizadas.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
