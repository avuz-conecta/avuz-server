import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Equipe Comercial';
const FIRST_MESSAGE = 'Bom dia, equipe! Reunião às 15h.';
const SECOND_MESSAGE = 'Alguém pode confirmar presença?';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

// Creates a solo conversation WITHOUT ever opening the "Adicionar
// participantes" picker. That picker lists every real user on the tenant,
// which is a privacy leak in a screencast — this flow is about chatting in a
// conversation, not participants, so a solo conversation is enough. The
// name-entry dialog already exposes a direct "Criando conversa" button once
// the name field is filled; clicking it skips the picker entirely.
async function createConversation(page: Page): Promise<void> {
  const newConversationButton = page.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(page, newConversationButton, 600);

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(CONVERSATION_NAME);
  await pause(500);

  const createButton = createDialog.getByRole('button', { name: 'Criando conversa' });
  await moveAndClick(page, createButton, 600);
  await page.getByRole('heading', { name: CONVERSATION_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

function chatInput(page: Page) {
  return page.locator('form.new-message-form div.rich-contenteditable__input[contenteditable]');
}

function sendButton(page: Page) {
  return page.getByRole('button', { name: 'Enviar mensagem' });
}

async function waitForChatReady(page: Page): Promise<void> {
  const input = chatInput(page);
  await input.waitFor({ state: 'visible', timeout: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    const placeholder = await input.getAttribute('aria-placeholder');
    if (placeholder && !placeholder.includes('Entrando')) return;
    await page.waitForTimeout(500);
  }
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = chatInput(page);
  await moveAndClick(page, input, 500);
  await input.type(text, { delay: 40 });
  await pause(500);

  await moveAndClick(page, sendButton(page), 500);
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 });
  await pause(800);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  await dismissBrowserWarning(page);
  await createConversation(page);
  await waitForChatReady(page);
  await pause(600);

  await sendMessage(page, FIRST_MESSAGE);
  await sendMessage(page, SECOND_MESSAGE);

  return [
    {
      n: 1,
      text: `Abra o **Talk**, clique em **Criar uma nova conversa**: dê um nome como **${CONVERSATION_NAME}** e confirme em **Criando conversa**.`,
    },
    {
      n: 2,
      text: 'Clique no campo **Escreva uma mensagem…**, na parte inferior da conversa, e digite o texto que deseja enviar.',
    },
    {
      n: 3,
      text: 'Clique em **Enviar mensagem** (ou pressione Enter): a mensagem aparece na hora como uma bolha na conversa.',
    },
    {
      n: 4,
      text: 'Continue digitando e enviando mensagens: cada uma entra logo abaixo da anterior, formando o histórico da conversa.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'talk',
  slug: 'conversar-por-mensagem',
  title: 'Como conversar por mensagem',
  description: 'Troque mensagens de texto com uma pessoa ou um grupo, mesmo sem chamada.',
  tip: 'Digite @ seguido do nome da pessoa para mencioná-la e avisá-la diretamente.',
  order: 6,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
