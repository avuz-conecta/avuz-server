import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  const menu = page.getByRole('menu');
  const baixarItem = menu.getByRole('menuitem', { name: 'Baixar', exact: true });
  await baixarItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);

  const downloadDir = await mkdtemp(join(tmpdir(), 'avuz-capture-download-'));
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), moveAndClick(page, baixarItem, 500)]);
    await download.saveAs(join(downloadDir, download.suggestedFilename()));
    await pause(1000);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }

  return [
    { n: 1, text: `Abra o **Drive** e localize o arquivo (ex.: **${FILE_NAME}**) na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Ações** na linha do arquivo.',
    },
    {
      n: 3,
      text: 'Selecione **Baixar**: o arquivo é salvo no seu computador, na pasta padrão de downloads do navegador.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'baixar-arquivos',
  title: 'Como baixar arquivos',
  description: 'Salve uma cópia de um arquivo no seu computador.',
  tip: 'Para baixar vários arquivos de uma vez, selecione-os e use Ações em massa.',
  order: 6,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
