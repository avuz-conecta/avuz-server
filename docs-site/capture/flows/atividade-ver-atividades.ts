import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveTo, pause } from '../lib/screencast';
import { webdavUrl } from '../seed/seed';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

function basicAuthHeader(uid: string, password: string): string {
  return `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
}

// resetTenant() already re-uploads relatorio.pdf before every capture run,
// which alone produces a "Você criou relatorio.pdf" activity. A follow-up
// edit adds a second, distinct entry ("Você modificou o arquivo ...") right
// above it, so the feed opens on a small, believable pair of file activities
// instead of a single line.
async function touchDemoFile(): Promise<void> {
  const response = await fetch(webdavUrl(CONFIG.stagingUrl, 'demo.ana', FILE_NAME), {
    method: 'PUT',
    headers: {
      Authorization: basicAuthHeader('demo.ana', CONFIG.demoUserPassword),
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(Buffer.from('%PDF-1.4\n%AVUZ-ATIVIDADE-CAPTURE\n%%EOF\n', 'latin1')),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to PUT ${FILE_NAME}: ${response.status}`);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  await touchDemoFile();
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const heading = page.getByRole('heading', { name: 'Todas as atividades', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const feedEntries = page.locator('li.activity-entry');
  const firstEntry = feedEntries.first();
  await firstEntry.waitFor({ state: 'visible', timeout: 15000 });
  await pause(500);

  const firstBox = await firstEntry.boundingBox();
  if (!firstBox) throw new Error('activity feed entry has no bounding box');
  await moveTo(page, firstBox);
  await pause(900);

  const thirdEntry = feedEntries.nth(2);
  await thirdEntry.waitFor({ state: 'visible', timeout: 10000 });
  const thirdBox = await thirdEntry.boundingBox();
  if (thirdBox) await moveTo(page, thirdBox);
  await pause(700);

  // Scroll the feed's own container, not the page, so older entries slide
  // into view under the cursor.
  const feedContainer = page.locator('.activity-app__container');
  await feedContainer.hover();
  await page.mouse.wheel(0, 350);
  await pause(1000);
  await page.mouse.wheel(0, 300);
  await pause(1000);

  return [
    { n: 1, text: 'Abra a **Atividade** para ver, em ordem do mais recente para o mais antigo, tudo o que mudou nos seus arquivos e apps.' },
    { n: 2, text: 'Cada item mostra o que aconteceu (ex.: **arquivo enviado**, **arquivo editado**) com o nome do item e a hora exata.' },
    { n: 3, text: 'Role a lista para trás e veja as atividades mais antigas, agrupadas por dia.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'atividade',
  slug: 'ver-atividades',
  title: 'Como ver suas atividades',
  description: 'Acompanhe o histórico do que aconteceu nos seus arquivos e apps.',
  tip: 'A Atividade mostra em ordem cronológica tudo o que mudou.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/activity`,
  setup,
  record,
};
