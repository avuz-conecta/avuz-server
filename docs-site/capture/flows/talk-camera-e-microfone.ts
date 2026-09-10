import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Chamada de Teste';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createConversation(page: Page): Promise<void> {
  const newConversationButton = page.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(page, newConversationButton, 600);

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(CONVERSATION_NAME);
  await pause(500);

  const addParticipantsButton = createDialog.getByRole('button', { name: 'Adicionar participantes' });
  await moveAndClick(page, addParticipantsButton, 500);

  const createButton = createDialog.getByRole('button', { name: 'Criando conversa' });
  await moveAndClick(page, createButton, 600);
  await page.getByRole('heading', { name: CONVERSATION_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

async function startCall(page: Page): Promise<void> {
  const label = 'Iniciar chamada';
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await pause(1000);
  }
  await dismissBrowserWarning(page);
  await moveAndClick(page, trigger, 600);

  const dialog = page.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: 20000 });
  await moveAndClick(page, confirmButton, 600);
}

async function toggleMicrophone(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true });
  await moveAndClick(page, button, 600);
}

async function toggleCamera(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first();
  await moveAndClick(page, button, 600);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  await dismissBrowserWarning(page);
  await createConversation(page);
  await pause(600);

  await startCall(page);
  await maskRealHost(page);
  await pause(2000);

  await toggleMicrophone(page, 'Desativar microfone');
  await page.getByRole('button', { name: 'Ativar microfone', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  await toggleCamera(page, 'Desativar vídeo');
  await page.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  await toggleCamera(page, 'Ativar vídeo');
  await page.getByRole('button', { name: 'Desativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  return [
    {
      n: 1,
      text: `Entre em uma chamada no **Talk**: crie uma conversa como **${CONVERSATION_NAME}** e clique em **Iniciar chamada**.`,
    },
    {
      n: 2,
      text: 'Na barra de controles da chamada, clique em **Desativar microfone** para silenciar o som; o botão passa a mostrar **Ativar microfone**.',
    },
    {
      n: 3,
      text: 'Clique em **Desativar vídeo** para desligar a câmera; sua imagem é substituída por um avatar e o botão passa a mostrar **Ativar vídeo**.',
    },
    {
      n: 4,
      text: 'Clique em **Ativar vídeo** para ligar a câmera de novo a qualquer momento durante a chamada.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'camera-e-microfone',
  title: 'Como ligar câmera e microfone',
  description: 'Ligue ou desligue seu microfone e sua câmera durante a chamada.',
  tip: 'Silencie o microfone quando não estiver falando para evitar ruído.',
  order: 4,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
