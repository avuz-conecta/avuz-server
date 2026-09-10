import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FOLDER_NAME = 'Projetos';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await newButton.click();
  const menu = page.getByRole('menu');
  const newFolderMenuItem = menu.getByRole('menuitem', { name: 'Nova pasta' });
  await newFolderMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await newFolderMenuItem.click();
  const dialog = page.getByRole('dialog');
  const nameField = dialog.getByRole('textbox');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(FOLDER_NAME);
  await shoot(page, framesDir, frame++);

  await dialog.getByRole('button', { name: 'Criar' }).click();

  const folderRow = page.getByRole('row', { name: new RegExp(FOLDER_NAME) });
  await folderRow.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como criar pastas',
    description: 'Organize seus arquivos em pastas dentro do Drive.',
    app: 'drive',
    slug: 'criar-pastas',
    order: 2,
    media: 'criar-pastas.mp4',
    tip: 'Arraste arquivos para dentro de uma pasta para movê-los rapidamente.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
