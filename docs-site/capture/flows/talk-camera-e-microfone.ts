import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, moveTo, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Chamada de Teste';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

// Creates a solo conversation WITHOUT ever opening the "Adicionar
// participantes" picker. That picker lists every real user on the tenant,
// which is a privacy leak in a screencast — this flow is about camera and
// microphone controls, not participants, so a solo conversation is enough.
// The name-entry dialog already exposes a direct "Criando conversa" button
// once the name field is filled; clicking it skips the picker entirely.
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

// Turns the camera off via the in-call toolbar, right after joining. This
// MUST be the very first action taken once the call view is up — before any
// other pause or click — so the synthetic color-bar feed is on screen for
// only a fraction of a second before the tile becomes a clean avatar.
// Proven pattern, reused from talk-iniciar-reuniao.ts's disableCameraInCall.
async function disableCameraInCall(page: Page): Promise<void> {
  const disableButton = page.getByRole('button', { name: 'Desativar vídeo' }).first();
  await disableButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(page, disableButton, 300);
  await page.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
}

async function toggleMicrophone(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label, exact: true });
  await moveAndClick(page, button, 600);
}

// Points the cursor at the camera button while it reads "Ativar vídeo"
// (camera off) WITHOUT clicking it. This flow is camera-A: the synthetic
// feed never turns back on, so the tile stays a clean avatar for the whole
// clip instead of flashing color bars when the fake track restarts.
async function showcaseCameraButtonOff(page: Page): Promise<void> {
  const cameraButton = page.getByRole('button', { name: 'Ativar vídeo' }).first();
  const box = await cameraButton.boundingBox();
  if (!box) throw new Error('showcaseCameraButtonOff: camera button has no bounding box (not visible?)');
  await moveTo(page, box);
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
  // Camera-A: kill the video feed before anything else happens, so the
  // color-bar window is a fraction of a second, never a showcased pause.
  await disableCameraInCall(page);
  await pause(1200);

  await toggleMicrophone(page, 'Desativar microfone');
  await page.getByRole('button', { name: 'Ativar microfone', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  await toggleMicrophone(page, 'Ativar microfone');
  await page.getByRole('button', { name: 'Desativar microfone', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  await showcaseCameraButtonOff(page);
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
      text: 'Clique em **Ativar microfone** para reativar o som a qualquer momento; o botão volta a mostrar **Desativar microfone**.',
    },
    {
      n: 4,
      text: 'O botão de vídeo liga e desliga sua câmera durante a chamada; quando desativada (**Ativar vídeo**), sua imagem aparece como um avatar para os demais participantes.',
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
