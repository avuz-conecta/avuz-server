import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';
const RECIPIENT_QUERY = 'Bruno';
const RECIPIENT_NAME = 'Bruno Lima';
const RECIPIENT_UID = 'demo.bruno';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const shareButton = fileRow.getByRole('button', { name: 'Opções de compartilhamento' });
  await moveAndClick(page, shareButton, 700);

  const sidebar = page.getByRole('complementary');
  const recipientSearch = sidebar.getByRole('combobox', { name: 'Pesquisar destinatários internos' });
  await recipientSearch.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);

  // Typing then selecting must stay tight: the recipient dropdown auto-closes
  // if there is a pause between filling the query and clicking the option.
  await moveAndClick(page, recipientSearch, 400);
  await recipientSearch.fill(RECIPIENT_QUERY);
  const recipientOption = page.getByRole('option').filter({ hasText: RECIPIENT_UID });
  await recipientOption.click({ timeout: 10000 });

  const confirmHeading = sidebar.getByRole('heading', { name: `Compartilhar com ${RECIPIENT_NAME}` });
  await confirmHeading.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1000);

  const saveButton = sidebar.getByRole('button', { name: 'Salvar compartilhamento' });
  await moveAndClick(page, saveButton, 700);

  const internalSharedList = sidebar.getByRole('list', { name: 'Compartilhamentos' }).first();
  await internalSharedList.getByText(RECIPIENT_NAME).waitFor({ state: 'visible', timeout: 15000 });
  await pause(1200);

  return [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Opções de compartilhamento** na linha do arquivo.',
    },
    {
      n: 3,
      text: `Em **Compartilhamentos internos**, digite o nome da pessoa (ex.: **${RECIPIENT_QUERY}**) no campo **Pesquisar destinatários internos** e selecione **${RECIPIENT_NAME}** na lista de resultados.`,
    },
    {
      n: 4,
      text: `Clique em **Salvar compartilhamento**: **${RECIPIENT_NAME}** aparece na lista de compartilhamentos, com acesso direto ao arquivo.`,
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'compartilhar-com-pessoas',
  title: 'Como compartilhar com uma pessoa',
  description: 'Convide um colega para ver ou editar um arquivo, sem link público.',
  tip: 'Quem recebe o compartilhamento vê o arquivo em Compartilhamentos, sem precisar de link.',
  order: 4,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
