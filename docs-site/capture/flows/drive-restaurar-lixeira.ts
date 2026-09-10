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
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await fileRow.getByRole('button', { name: 'Ações' }).click();
  const fileMenu = page.getByRole('menu');
  const excluirItem = fileMenu.getByRole('menuitem', { name: 'Excluir arquivo', exact: true });
  await excluirItem.waitFor({ state: 'visible', timeout: 10000 });
  await excluirItem.click();
  await fileRow.waitFor({ state: 'hidden', timeout: 15000 });

  const trashLink = page.getByRole('link', { name: 'Arquivos excluídos' });
  await trashLink.click();
  await page.waitForURL(/\/apps\/files\/trashbin/, { timeout: 15000 });

  const trashRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) }).first();
  await trashRow.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, framesDir, frame++);

  const restoreButton = trashRow.getByRole('button', { name: 'Restaurar' });
  await restoreButton.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);
  await restoreButton.click();

  await page.goto(`${CONFIG.stagingUrl}/apps/files`);
  const restoredRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await restoredRow.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
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

  return {
    title: 'Como restaurar um arquivo da lixeira',
    description: 'Recupere um arquivo excluído por engano.',
    app: 'drive',
    slug: 'restaurar-da-lixeira',
    order: 7,
    media: 'restaurar-da-lixeira.mp4',
    tip: 'A lixeira guarda arquivos por um tempo antes de removê-los de vez.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
