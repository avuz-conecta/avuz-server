import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';
const SEARCH_QUERY = 'relatorio';

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const searchInput = page.getByPlaceholder(/Pesquisar aqui/);
  await searchInput.waitFor({ state: 'visible', timeout: 20000 });
  await searchInput.click();
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await searchInput.fill(SEARCH_QUERY);
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await fileRow.getByRole('button', { name: 'Ações' }).click();
  const menu = page.getByRole('menu');
  const favoriteItem = menu.getByRole('menuitem', { name: 'Adicionar aos favoritos', exact: true });
  await favoriteItem.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await favoriteItem.click();

  const favoritosLink = page.getByRole('link', { name: 'Favoritos' });
  await favoritosLink.click();
  await page.waitForURL(/\/apps\/files\/favorites/, { timeout: 15000 });

  const favoriteRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await favoriteRow.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
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
      text: `Abra **Favoritos** no menu lateral para ver **${FILE_NAME}** marcado com uma estrela na lista.`,
    },
  ];

  return {
    title: 'Como buscar e favoritar arquivos',
    description: 'Encontre arquivos rapidamente e marque os mais usados como favoritos.',
    app: 'drive',
    slug: 'buscar-e-favoritar',
    order: 9,
    media: 'buscar-e-favoritar.mp4',
    tip: 'Os favoritos ficam reunidos em **Favoritos**, na barra lateral, para acesso rápido aos arquivos mais usados.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
