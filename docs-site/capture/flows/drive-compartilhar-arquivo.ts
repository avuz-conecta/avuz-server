import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  // Clipboard permissions apply per-context, so they must be granted on the
  // recorded context itself (the unrecorded setup context is already closed).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const shareButton = fileRow.getByRole('button', { name: 'Opções de compartilhamento' });
  await moveAndClick(page, shareButton, 700);

  const sidebar = page.getByRole('complementary');
  await sidebar.getByText('Criar link público').waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1000);

  const createLinkButton = sidebar.getByRole('button', { name: 'Criar um novo link de compartilhamento' });
  await moveAndClick(page, createLinkButton, 600);

  await sidebar.getByText('Link de compartilhamento').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Link copiado').waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1200);

  // The toast above auto-dismisses after a few seconds; wait it out so the
  // recording settles on the final share entry instead of a stacked toast.
  await page.getByText('Link copiado').waitFor({ state: 'hidden', timeout: 15000 });
  await maskRealHost(page);
  await pause(1000);

  return [
    { n: 1, text: `Abra o **Drive** e localize o arquivo (ex.: **${FILE_NAME}**) na lista de arquivos.` },
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
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'compartilhar-arquivo',
  title: 'Como compartilhar um arquivo',
  description: 'Gere um link para enviar um arquivo a qualquer pessoa.',
  tip: 'Precisa de mais controle? Defina senha e validade no mesmo painel de compartilhamento.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
