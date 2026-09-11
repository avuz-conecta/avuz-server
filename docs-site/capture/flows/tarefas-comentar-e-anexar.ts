import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const BOARD_NAME = 'Suporte ao Cliente';
const LIST_NAME = 'Em análise';
const CARD_TITLE = 'Chamado #1042';
const COMMENT_TEXT = 'Aguardando retorno do cliente.';
const ATTACHMENT_NAME = 'orcamento.pdf';

function buildMinimalPdf(): Buffer {
  const header = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ];
  let body = header;
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

async function createTempAttachment(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'avuz-capture-attachment-'));
  const filePath = join(dir, ATTACHMENT_NAME);
  await writeFile(filePath, new Uint8Array(buildMinimalPdf()));
  return filePath;
}

async function createBoardWithListAndCard(page: Page): Promise<void> {
  const addBoardLink = page.getByRole('link', { name: 'Adicionar painel' });
  await addBoardLink.waitFor({ state: 'visible', timeout: 20000 });
  await addBoardLink.click();

  const nameField = page.getByPlaceholder('Nome do painel');
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(BOARD_NAME);
  await page.getByRole('button', { name: 'Salvar painel' }).click();

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 15000 });
  await boardLink.click();

  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });

  const emptyContent = page.locator('.empty-content');
  const listInput = emptyContent.getByPlaceholder('Nome da lista');
  await listInput.waitFor({ state: 'visible', timeout: 15000 });
  await listInput.fill(LIST_NAME);
  await emptyContent.getByRole('button', { name: 'Adicionar lista' }).click();

  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  await list.waitFor({ state: 'visible', timeout: 15000 });

  const addCardButton = list.getByRole('button', { name: 'Adicionar cartão' });
  await addCardButton.click();

  const cardInput = list.getByPlaceholder('Nome do cartão');
  await cardInput.waitFor({ state: 'visible', timeout: 10000 });
  await cardInput.fill(CARD_TITLE);
  await cardInput.press('Enter');

  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/deck`);
  await createBoardWithListAndCard(page);
  return context;
}

async function openBoard(page: Page): Promise<void> {
  const boardHeading = page.getByRole('heading', { name: BOARD_NAME });
  if (await boardHeading.isVisible().catch(() => false)) return;

  const boardLink = page.getByRole('link', { name: BOARD_NAME }).last();
  await boardLink.waitFor({ state: 'visible', timeout: 20000 });
  await pause(500);
  await moveAndClick(page, boardLink, 500);
  await boardHeading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(800);
}

async function openCardDetail(page: Page): Promise<void> {
  const list = page.locator(`[data-cy-stack="${LIST_NAME}"]`);
  const card = list.locator('.card').filter({ hasText: CARD_TITLE });
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await pause(400);
  await moveAndClick(page, card, 500);

  const sidebarTitle = page.locator('.app-sidebar-header__mainname', { hasText: CARD_TITLE });
  await sidebarTitle.waitFor({ state: 'visible', timeout: 15000 });
  await pause(1000);
}

async function addComment(page: Page): Promise<void> {
  const commentsTab = page.locator('#tab-button-comments');
  await moveAndClick(page, commentsTab, 500);

  const commentInput = page.locator('#tab-comments [role="textbox"]');
  await commentInput.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await commentInput.click();
  await commentInput.fill(COMMENT_TEXT);
  await pause(500);
  await commentInput.press('Enter');

  const postedComment = page.locator('#tab-comments').getByText(COMMENT_TEXT);
  await postedComment.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);
}

async function addAttachment(page: Page): Promise<void> {
  const attachmentsTab = page.locator('#tab-button-attachments');
  await moveAndClick(page, attachmentsTab, 500);

  const uploadButton = page.locator('#tab-attachments').getByRole('button', { name: 'Enviar novos arquivos' });
  await uploadButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);

  const tempFilePath = await createTempAttachment();
  try {
    const fileInput = page.locator('#tab-attachments input[type="file"]');
    await fileInput.setInputFiles(tempFilePath);

    const uploadedAttachment = page.locator('#tab-attachments li.attachment').first();
    await uploadedAttachment.waitFor({ state: 'visible', timeout: 20000 });
    await pause(1000);
  } finally {
    await rm(dirname(tempFilePath), { recursive: true, force: true });
  }
}

async function record(page: Page): Promise<readonly Step[]> {
  await openBoard(page);
  await openCardDetail(page);
  await addComment(page);
  await addAttachment(page);

  return [
    { n: 1, text: `Abra o cartão (ex.: **${CARD_TITLE}**) e clique na aba **Comentários**.` },
    { n: 2, text: `Escreva sua mensagem no campo **Escreva uma mensagem…** (ex.: "${COMMENT_TEXT}") e pressione Enter para publicar.` },
    { n: 3, text: 'Clique na aba **Anexos** para ver os arquivos do cartão.' },
    { n: 4, text: `Clique em **Enviar novos arquivos** e escolha o arquivo no seu computador (ex.: **${ATTACHMENT_NAME}**).` },
    { n: 5, text: 'Comentários e anexos ficam salvos no cartão, disponíveis para toda a equipe.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'tarefas',
  slug: 'comentar-e-anexar',
  title: 'Como comentar e anexar num cartão',
  description: 'Registre comentários e anexe arquivos direto no cartão da tarefa.',
  tip: 'Use comentários para manter o histórico da tarefa em um só lugar.',
  order: 7,
  startUrl: `${CONFIG.stagingUrl}/apps/deck`,
  setup,
  record,
};
