import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FOLDER_NAME = 'Projetos';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newButton, 500);

  const menu = page.getByRole('menu');
  const newFolderMenuItem = menu.getByRole('menuitem', { name: 'Nova pasta' });
  await newFolderMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, newFolderMenuItem, 500);

  const dialog = page.getByRole('dialog');
  const nameField = dialog.getByRole('textbox');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await nameField.fill(FOLDER_NAME);
  await pause(600);

  const createButton = dialog.getByRole('button', { name: 'Criar' });
  await moveAndClick(page, createButton, 500);

  const folderRow = page.getByRole('row', { name: new RegExp(FOLDER_NAME) });
  await folderRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra o **Drive** e clique em **Novo** na barra superior da lista de arquivos.' },
    {
      n: 2,
      text: 'Selecione **Nova pasta**.',
    },
    {
      n: 3,
      text: `Digite um nome para a pasta (ex.: **${FOLDER_NAME}**) e clique em **Criar**.`,
    },
    {
      n: 4,
      text: 'A pasta é criada na hora e aparece na lista de arquivos, pronta para receber documentos.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'criar-pastas',
  title: 'Como criar pastas',
  description: 'Organize seus arquivos em pastas dentro do Drive.',
  tip: 'Arraste arquivos para dentro de uma pasta para movê-los rapidamente.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
