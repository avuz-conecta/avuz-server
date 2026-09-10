import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const CONVERSATION_NAME = 'Equipe Comercial';
const FIRST_MESSAGE = 'Bom dia, equipe! Reunião às 15h.';
const SECOND_MESSAGE = 'Alguém pode confirmar presença?';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createConversation(page: Page): Promise<void> {
  await page.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(page);
  await page.getByRole('button', { name: 'Criar uma nova conversa' }).click();

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(CONVERSATION_NAME);

  await createDialog.getByRole('button', { name: 'Adicionar participantes' }).click();
  await createDialog.getByRole('button', { name: 'Criando conversa' }).click();
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
  await input.click();
  await input.type(text);
  await sendButton(page).click();
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);

  let frame = 0;
  await createConversation(page);
  await waitForChatReady(page);
  await shoot(page, framesDir, frame++);

  const input = chatInput(page);
  await input.click();
  await input.type(FIRST_MESSAGE);
  await shoot(page, framesDir, frame++);

  await sendButton(page).click();
  await page.getByText(FIRST_MESSAGE).first().waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  await sendMessage(page, SECOND_MESSAGE);
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como conversar por mensagem',
    description: 'Troque mensagens de texto com uma pessoa ou um grupo, mesmo sem chamada.',
    app: 'talk',
    slug: 'conversar-por-mensagem',
    order: 6,
    media: 'conversar-por-mensagem.mp4',
    tip: 'Digite @ seguido do nome da pessoa para mencioná-la e avisá-la diretamente.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
