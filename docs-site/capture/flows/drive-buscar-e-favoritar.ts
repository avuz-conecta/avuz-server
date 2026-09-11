import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';
const SEARCH_QUERY = 'relatorio';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const searchInput = page.getByPlaceholder(/Pesquisar aqui/);
  await searchInput.waitFor({ state: 'visible', timeout: 20000 });
  await moveAndClick(page, searchInput, 500);

  await searchInput.fill(SEARCH_QUERY);
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);

  const acoesButton = fileRow.getByRole('button', { name: 'Ações' });
  await moveAndClick(page, acoesButton, 500);

  const menu = page.getByRole('menu');
  const favoriteItem = menu.getByRole('menuitem', { name: 'Adicionar aos favoritos', exact: true });
  await favoriteItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, favoriteItem, 500);

  const favoritosLink = page.getByRole('link', { name: 'Favoritos' });
  await moveAndClick(page, favoritosLink, 500);
  await page.waitForURL(/\/apps\/files\/favorites/, { timeout: 15000 });

  const favoriteRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await favoriteRow.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra o **Drive** e clique no campo **Pesquisar aqui** na barra lateral.' },
    {
      n: 2,
      text: `Digite o nome ou parte do nome do arquivo (ex.: **${SEARCH_QUERY}**): a lista é filtrada na hora, mostrando **${FILE_NAME}**.`,
    },
    {
      n: 3,
      text: 'Clique em **Ações** na linha do arquivo e selecione **Adicionar aos favoritos**.',
    },
    {
      n: 4,
      text: `Abra **Favoritos** no menu lateral para ver o arquivo (ex.: **${FILE_NAME}**) marcado com uma estrela na lista.`,
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'drive',
  slug: 'buscar-e-favoritar',
  title: 'Como buscar e favoritar arquivos',
  description: 'Encontre arquivos rapidamente e marque os mais usados como favoritos.',
  tip: 'Os favoritos ficam reunidos em **Favoritos**, na barra lateral, para acesso rápido aos arquivos mais usados.',
  order: 9,
  startUrl: `${CONFIG.stagingUrl}/apps/files`,
  setup,
  record,
};
