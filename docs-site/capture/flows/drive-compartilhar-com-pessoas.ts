import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';
const RECIPIENT_QUERY = 'Bruno';
const RECIPIENT_NAME = 'Bruno Lima';
const RECIPIENT_UID = 'demo.bruno';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });

  await fileRow.getByRole('button', { name: 'Opções de compartilhamento' }).click();
  const sidebar = page.getByRole('complementary');
  const recipientSearch = sidebar.getByRole('combobox', { name: 'Pesquisar destinatários internos' });
  await recipientSearch.waitFor({ state: 'visible', timeout: 10000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await recipientSearch.click();
  await recipientSearch.fill(RECIPIENT_QUERY);
  const recipientOption = page.getByRole('option').filter({ hasText: RECIPIENT_UID });
  await recipientOption.click({ timeout: 10000 });

  const confirmHeading = sidebar.getByRole('heading', { name: `Compartilhar com ${RECIPIENT_NAME}` });
  await confirmHeading.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await sidebar.getByRole('button', { name: 'Salvar compartilhamento' }).click();

  const internalSharedList = sidebar.getByRole('list', { name: 'Compartilhamentos' }).first();
  await internalSharedList.getByText(RECIPIENT_NAME).waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como compartilhar com uma pessoa',
    description: 'Convide um colega para ver ou editar um arquivo, sem link público.',
    app: 'drive',
    slug: 'compartilhar-com-pessoas',
    order: 4,
    media: 'compartilhar-com-pessoas.mp4',
    tip: 'Quem recebe o compartilhamento vê o arquivo em Compartilhamentos, sem precisar de link.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
