import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });

  await fileRow.getByRole('button', { name: 'Ações' }).click();
  const menu = page.getByRole('menu');
  const baixarItem = menu.getByRole('menuitem', { name: 'Baixar', exact: true });
  await baixarItem.waitFor({ state: 'visible', timeout: 10000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  const downloadDir = await mkdtemp(join(tmpdir(), 'avuz-capture-download-'));
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), baixarItem.click()]);
    await download.saveAs(join(downloadDir, download.suggestedFilename()));
    await shoot(page, framesDir, frame++);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Ações** na linha do arquivo.',
    },
    {
      n: 3,
      text: 'Selecione **Baixar**: o arquivo é salvo no seu computador, na pasta padrão de downloads do navegador.',
    },
  ];

  return {
    title: 'Como baixar arquivos',
    description: 'Salve uma cópia de um arquivo no seu computador.',
    app: 'drive',
    slug: 'baixar-arquivos',
    order: 6,
    media: 'baixar-arquivos.mp4',
    tip: 'Para baixar vários arquivos de uma vez, selecione-os e use Ações em massa.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
