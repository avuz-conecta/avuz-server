import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const FOLDER_NAME = 'Recebidos';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  // Clipboard permissions apply per-context, so they must be granted on the
  // recorded context itself (the unrecorded setup context is already closed).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newButton, 500);

  const menu = page.getByRole('menu');
  const newFolderMenuItem = menu.getByRole('menuitem', { name: 'Nova pasta' });
  await newFolderMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, newFolderMenuItem, 500);

  const dialog = page.getByRole('dialog');
  const nameField = dialog.getByRole('textbox');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await nameField.fill(FOLDER_NAME);
  await pause(600);

  const createButton = dialog.getByRole('button', { name: 'Criar' });
  await moveAndClick(page, createButton, 500);

  const folderRow = page.getByRole('row', { name: new RegExp(FOLDER_NAME) });
  await folderRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  const shareButton = folderRow.getByRole('button', { name: 'Opções de compartilhamento' });
  await moveAndClick(page, shareButton, 700);

  const sidebar = page.getByRole('complementary');
  await sidebar.getByText('Criar link público').waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1000);

  const createLinkButton = sidebar.getByRole('button', { name: 'Criar um novo link de compartilhamento' });
  await moveAndClick(page, createLinkButton, 600);

  // Creating the link auto-copies its URL and can surface the real staging
  // host in the share row — mask it the moment the row settles.
  const linkRow = sidebar
    .getByRole('list', { name: 'Compartilhamentos por link' })
    .getByRole('listitem')
    .filter({ hasText: 'Link de compartilhamento' });
  const permissionButton = linkRow.getByRole('button', { name: 'Somente visualização' });
  await permissionButton.waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1000);

  await moveAndClick(page, permissionButton, 600);

  const permissionMenu = page.getByRole('menu', { name: 'Somente visualização' });
  const fileRequestOption = permissionMenu.getByRole('menuitemradio', { name: 'Solicitação de arquivo' });
  await fileRequestOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, fileRequestOption, 500);

  await linkRow.getByRole('button', { name: 'Solicitação de arquivo' }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Permissões do compartilhamento salvas').waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(800);

  // Toasts auto-dismiss after a few seconds; wait them out so the recording
  // settles on the final share entry instead of a stacked toast.
  await page.getByText('Permissões do compartilhamento salvas').waitFor({ state: 'hidden', timeout: 15000 });
  await maskRealHost(page);
  await pause(1000);

  return [
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
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'solicitar-arquivos',
  title: 'Como solicitar arquivos',
  description: 'Crie um link para que outras pessoas enviem arquivos para você, sem precisarem de conta.',
  tip: 'Quem recebe o link só pode enviar arquivos: não vê os arquivos que já estão na pasta.',
  order: 10,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
