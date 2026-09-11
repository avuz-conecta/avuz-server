import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const acoesButton = fileRow.getByRole('button', { name: 'Ações' });
  await moveAndClick(page, acoesButton, 500);

  const fileMenu = page.getByRole('menu');
  const excluirItem = fileMenu.getByRole('menuitem', { name: 'Excluir arquivo', exact: true });
  await excluirItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, excluirItem, 500);
  await fileRow.waitFor({ state: 'hidden', timeout: 15000 });
  await pause(600);

  const trashLink = page.getByRole('link', { name: 'Arquivos excluídos' });
  await moveAndClick(page, trashLink, 500);
  await page.waitForURL(/\/apps\/files\/trashbin/, { timeout: 15000 });

  const trashRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) }).first();
  await trashRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(800);

  const restoreButton = trashRow.getByRole('button', { name: 'Restaurar' });
  await moveAndClick(page, restoreButton, 500);

  await page.goto(`${CONFIG.stagingUrl}/apps/files`);
  const restoredRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await restoredRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: `Abra o **Drive** e localize o arquivo (ex.: **${FILE_NAME}**) na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Ações** na linha do arquivo e selecione **Excluir arquivo**.',
    },
    {
      n: 3,
      text: 'Abra **Arquivos excluídos** no menu lateral para ver o arquivo na lixeira.',
    },
    {
      n: 4,
      text: 'Clique em **Restaurar** na linha do arquivo.',
    },
    {
      n: 5,
      text: 'O arquivo volta para a lista principal do Drive, no local original.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'restaurar-da-lixeira',
  title: 'Como restaurar um arquivo da lixeira',
  description: 'Recupere um arquivo excluído por engano.',
  tip: 'A lixeira guarda arquivos por um tempo antes de removê-los de vez.',
  order: 7,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
