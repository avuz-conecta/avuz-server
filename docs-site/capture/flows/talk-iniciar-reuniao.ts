import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login, loginOnPage } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const MEETING_NAME = 'Reunião Conecta Demo';
const GUEST_DISPLAY_NAME = 'Bruno Lima';
const CALL_PARTICIPANT_COUNT = 2;
const CALL_WAIT_TIMEOUT_MS = 40000;

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createMeeting(host: Page): Promise<void> {
  const newConversationButton = host.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(host, newConversationButton, 600);

  const createDialog = host.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(MEETING_NAME);
  await pause(500);

  const addParticipantsButton = createDialog.getByRole('button', { name: 'Adicionar participantes' });
  await moveAndClick(host, addParticipantsButton, 500);

  const participantSearch = createDialog.getByLabel('Procurar participantes');
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await participantSearch.fill('demo.bruno');

  const brunoOption = createDialog.getByText(GUEST_DISPLAY_NAME).first();
  await brunoOption.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(host, brunoOption, 500);

  const createButton = createDialog.getByRole('button', { name: 'Criando conversa' });
  await moveAndClick(host, createButton, 600);
  await host.getByRole('heading', { name: MEETING_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

// Joins/starts the call via the device-check dialog's confirm button (same
// pattern as talk-camera-e-microfone.ts's startCall). The pre-join "Sem
// câmera" toggle is NOT used here — it isn't reliably present/named that way
// on this dialog and times out. Camera is turned off via the in-call toolbar
// instead, right after joining (see disableCameraInCall below).
async function startOrJoinCall(page: Page, label: string): Promise<void> {
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

// Turns the camera off via the in-call toolbar, right after a party joins.
// The tile switches from the synthetic color-bar feed to a clean avatar
// (initials circle) as soon as Talk registers the track is off. Reused
// selectors from talk-camera-e-microfone.ts, which already exercises this
// toggle live.
async function disableCameraInCall(page: Page): Promise<void> {
  const disableButton = page.getByRole('button', { name: 'Desativar vídeo' }).first();
  await disableButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(page, disableButton, 300);
  await page.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
}

// Robust presence check that does NOT depend on <video> elements: with
// cameras off, Talk keeps a hidden <video> per tile (display:none) instead of
// omitting it, so counting video nodes is unreliable either way. The call
// header's participant badge (aria-label "N participante(s) na chamada") is
// the stable signal that both avatar tiles have actually joined.
async function waitForCallParticipants(page: Page, participantCount: number, timeoutMs: number): Promise<void> {
  const label = new RegExp(`^${participantCount} participantes? na chamada$`);
  const participantBadge = page.getByRole('button', { name: label });
  await participantBadge.waitFor({ state: 'visible', timeout: timeoutMs });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(hostPage: Page): Promise<readonly Step[]> {
  await dismissBrowserWarning(hostPage);
  await createMeeting(hostPage);
  await pause(400);

  await startOrJoinCall(hostPage, 'Iniciar chamada');
  await maskRealHost(hostPage);
  // Turn the camera off promptly — any color-bar frame before this registers
  // is brief, and the recorded "showcase" pause happens later, once both
  // parties' tiles are clean avatars.
  await disableCameraInCall(hostPage);
  await pause(300);

  // The guest joins from a separate context spawned off the SAME browser
  // instance, so it inherits the fake-media launch flags (mic permission,
  // no real camera prompt) just like the host's recorded context. Both sides
  // disable their camera via the in-call toolbar right after joining, so
  // each renders as a clean avatar tile instead of a video feed.
  const hostBrowser = hostPage.context().browser();
  if (!hostBrowser) throw new Error('recorded context has no browser');
  const guestContext = await hostBrowser.newContext({
    viewport: CONFIG.viewport,
    permissions: ['camera', 'microphone'],
  });
  const guestPage = await guestContext.newPage();
  await loginOnPage(guestPage, 'demo.bruno', CONFIG.demoUserPassword);
  await guestPage.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(guestPage);

  const conversationEntry = guestPage.getByRole('link', { name: new RegExp(MEETING_NAME) }).first();
  await conversationEntry.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await conversationEntry.click();

  await startOrJoinCall(guestPage, 'Entrar na chamada');
  await disableCameraInCall(guestPage);

  await waitForCallParticipants(hostPage, CALL_PARTICIPANT_COUNT, CALL_WAIT_TIMEOUT_MS);
  await maskRealHost(hostPage);
  await pause(1500);

  await guestContext.close();

  return [
    {
      n: 1,
      text: `Abra o **Talk** e clique em **Criar uma nova conversa**: dê um nome como **${MEETING_NAME}**, adicione os participantes e confirme em **Criando conversa**.`,
    },
    {
      n: 2,
      text: 'Clique em **Iniciar chamada** e confirme em **Iniciar chamada** na tela de verificação de câmera e microfone.',
    },
    {
      n: 3,
      text: 'Quando os convidados clicam em **Entrar na chamada**, eles aparecem lado a lado com você na chamada de vídeo.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'iniciar-reuniao',
  title: 'Como iniciar uma reunião',
  description: 'Crie uma sala no Talk e comece uma chamada de vídeo em segundos.',
  tip: 'Compartilhe a tela pelo ícone de monitor durante a chamada.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
