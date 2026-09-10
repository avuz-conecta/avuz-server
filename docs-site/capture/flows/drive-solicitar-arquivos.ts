import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FOLDER_NAME = 'Recebidos';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  await newButton.click();
  const menu = page.getByRole('menu');
  const newFolderMenuItem = menu.getByRole('menuitem', { name: 'Nova pasta' });
  await newFolderMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await newFolderMenuItem.click();

  const dialog = page.getByRole('dialog');
  const nameField = dialog.getByRole('textbox');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(FOLDER_NAME);
  await dialog.getByRole('button', { name: 'Criar' }).click();

  const folderRow = page.getByRole('row', { name: new RegExp(FOLDER_NAME) });
  await folderRow.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await folderRow.getByRole('button', { name: 'Opções de compartilhamento' }).click();
  const sidebar = page.getByRole('complementary');
  await sidebar.getByText('Criar link público').waitFor({ state: 'visible', timeout: 10000 });

  await sidebar.getByRole('button', { name: 'Criar um novo link de compartilhamento' }).click();
  const linkRow = sidebar.getByRole('list', { name: 'Compartilhamentos por link' }).getByRole('listitem').filter({ hasText: 'Link de compartilhamento' });
  const permissionButton = linkRow.getByRole('button', { name: 'Somente visualização' });
  await permissionButton.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await permissionButton.click();
  const permissionMenu = page.getByRole('menu', { name: 'Somente visualização' });
  const fileRequestOption = permissionMenu.getByRole('menuitemradio', { name: 'Solicitação de arquivo' });
  await fileRequestOption.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await fileRequestOption.click();
  await linkRow.getByRole('button', { name: 'Solicitação de arquivo' }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Permissões do compartilhamento salvas').waitFor({ state: 'visible', timeout: 10000 });
  // Toasts auto-dismiss after a few seconds; wait them out so the final
  // frame shows the settled share entry instead of stacked toasts.
  await page.getByText('Permissões do compartilhamento salvas').waitFor({ state: 'hidden', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive**, clique em **Novo** e selecione **Nova pasta**. Digite um nome (ex.: **${FOLDER_NAME}**) e clique em **Criar**.` },
    {
      n: 2,
      text: `Na pasta **${FOLDER_NAME}**, clique em **Opções de compartilhamento** e, em **Compartilhamentos externos**, clique em **Criar link público**.`,
    },
    {
      n: 3,
      text: 'Clique no botão de permissão do link (**Somente visualização**) e escolha **Solicitação de arquivo** na lista.',
    },
    {
      n: 4,
      text: 'O link passa a valer só para envio: quem recebe consegue enviar arquivos para a pasta, sem ver o que já está nela nem precisar de conta.',
    },
  ];

  return {
    title: 'Como solicitar arquivos',
    description: 'Crie um link para que outras pessoas enviem arquivos para você, sem precisarem de conta.',
    app: 'drive',
    slug: 'solicitar-arquivos',
    order: 10,
    media: 'solicitar-arquivos.mp4',
    tip: 'Quem recebe o link só pode enviar arquivos: não vê os arquivos que já estão na pasta.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
