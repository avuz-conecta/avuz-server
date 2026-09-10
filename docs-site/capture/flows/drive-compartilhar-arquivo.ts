import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(`${CONFIG.stagingUrl}/apps/files`);
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await fileRow.getByRole('button', { name: 'Opções de compartilhamento' }).click();
  const sidebar = page.getByRole('complementary');
  await sidebar.getByText('Criar link público').waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await sidebar.getByRole('button', { name: 'Criar um novo link de compartilhamento' }).click();
  await sidebar.getByText('Link de compartilhamento').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Link copiado').waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  // The toasts above auto-dismiss after a few seconds; wait them out so the
  // final frame shows the settled share entry instead of stacked toasts.
  await page.getByText('Link copiado').waitFor({ state: 'hidden', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Opções de compartilhamento** na linha do arquivo.',
    },
    {
      n: 3,
      text: 'Em **Compartilhamentos externos**, clique em **Criar link público**: o Drive gera o link e já copia o endereço, confirmando com **Link copiado**.',
    },
    {
      n: 4,
      text: 'O link é criado e copiado automaticamente, disponível em **Link de compartilhamento** — é só colar onde quiser (e-mail, mensagem) para compartilhar.',
    },
  ];

  return {
    title: 'Como compartilhar um arquivo',
    description: 'Gere um link para enviar um arquivo a qualquer pessoa.',
    app: 'drive',
    slug: 'compartilhar-arquivo',
    order: 1,
    media: 'compartilhar-arquivo.mp4',
    tip: 'Precisa de mais controle? Defina senha e validade no mesmo painel de compartilhamento.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
