import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { webdavUrl } from '../seed/seed';
import type { Step } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';
const COMMENT_MESSAGE = 'Revisado, tudo certo.';

function basicAuthHeader(uid: string, password: string): string {
  return `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
}

// resetTenant() already re-uploads relatorio.pdf before every capture run,
// which produces a "Você criou relatorio.pdf" activity. A follow-up edit adds
// a distinct "Você modificou o arquivo ..." entry, and a comment adds a third,
// differently-categorized entry — so the feed opens on a small, believable mix
// of file and comment activities for the filter to narrow down.
async function editDemoFile(): Promise<void> {
  const response = await fetch(webdavUrl(CONFIG.stagingUrl, 'demo.ana', FILE_NAME), {
    method: 'PUT',
    headers: {
      Authorization: basicAuthHeader('demo.ana', CONFIG.demoUserPassword),
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(Buffer.from('%PDF-1.4\n%AVUZ-ATIVIDADE-FILTRO-CAPTURE\n%%EOF\n', 'latin1')),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to PUT ${FILE_NAME}: ${response.status}`);
}

async function demoFileId(): Promise<string> {
  const response = await fetch(webdavUrl(CONFIG.stagingUrl, 'demo.ana', FILE_NAME), {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuthHeader('demo.ana', CONFIG.demoUserPassword),
      Depth: '0',
      'Content-Type': 'application/xml',
    },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
  });
  if (!response.ok) throw new Error(`Failed to PROPFIND ${FILE_NAME}: ${response.status}`);
  const xml = await response.text();
  const match = xml.match(/<oc:fileid>(\d+)<\/oc:fileid>/);
  if (!match) throw new Error(`No fileid found for ${FILE_NAME}`);
  return match[1];
}

async function commentOnDemoFile(fileId: string): Promise<void> {
  const response = await fetch(`${CONFIG.stagingUrl}/remote.php/dav/comments/files/${fileId}`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader('demo.ana', CONFIG.demoUserPassword),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ actorType: 'users', verb: 'comment', message: COMMENT_MESSAGE }),
  });
  if (response.status === 201) return;
  throw new Error(`Failed to POST comment on ${FILE_NAME}: ${response.status}`);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  await editDemoFile();
  const fileId = await demoFileId();
  await commentOnDemoFile(fileId);
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const allHeading = page.getByRole('heading', { name: 'Todas as atividades', exact: true });
  await allHeading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const feedEntries = page.locator('li.activity-entry');
  const commentEntry = feedEntries.filter({ hasText: COMMENT_MESSAGE }).first();
  await commentEntry.waitFor({ state: 'visible', timeout: 15000 });
  await pause(800);

  const filesFilterLink = page.getByRole('link', { name: 'Mudanças nos arquivos', exact: true });
  await moveAndClick(page, filesFilterLink, 500);

  const filesHeading = page.getByRole('heading', { name: 'Mudanças nos arquivos', exact: true });
  await filesHeading.waitFor({ state: 'visible', timeout: 15000 });
  await commentEntry.waitFor({ state: 'hidden', timeout: 10000 });
  await pause(1100);

  const allFilterLink = page.getByRole('link', { name: 'Todas as atividades', exact: true });
  await moveAndClick(page, allFilterLink, 500);
  await allHeading.waitFor({ state: 'visible', timeout: 15000 });
  await commentEntry.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);

  return [
    { n: 1, text: 'Abra a **Atividade** e veja tudo junto: arquivos alterados, comentários e mais, do mais recente para o mais antigo.' },
    { n: 2, text: 'No menu à esquerda, clique em uma categoria — ex.: **Mudanças nos arquivos** — para filtrar a lista.' },
    { n: 3, text: 'A lista passa a mostrar só as atividades dessa categoria; comentários e outros tipos somem da tela.' },
    { n: 4, text: 'Clique em **Todas as atividades** para voltar a ver tudo junto de novo.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'atividade',
  slug: 'filtrar-atividades',
  title: 'Como filtrar as atividades',
  description: 'Veja só as atividades de um tipo — arquivos, calendário, comentários e mais.',
  tip: 'Filtre por categoria para achar rápido o que você procura.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/activity`,
  setup,
  record,
};
