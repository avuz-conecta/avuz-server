import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login, loginOnPage } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const MEETING_NAME = 'Reunião Semanal';
const GUEST_DISPLAY_NAME = 'Bruno Lima';
const CALL_PARTICIPANT_COUNT = 2;
const CALL_WAIT_TIMEOUT_MS = 40000;

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

// Ana (the host) runs off-camera in her own spawned context, so her setup
// is unpaced: it never appears in the recording, only its wall-clock time
// does, so it stays as fast as the app allows.
async function createMeetingAsHost(host: Page): Promise<void> {
  await host.getByRole('button', { name: 'Criar uma nova conversa' }).click();

  const createDialog = host.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(MEETING_NAME);

  await createDialog.getByRole('button', { name: 'Adicionar participantes' }).click();
  const participantSearch = createDialog.getByLabel('Procurar participantes');
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await participantSearch.fill('demo.bruno');

  const brunoOption = createDialog.getByText(GUEST_DISPLAY_NAME).first();
  await brunoOption.waitFor({ state: 'visible', timeout: 15000 });
  await brunoOption.click();

  await createDialog.getByRole('button', { name: 'Criando conversa' }).click();
  await host.getByRole('heading', { name: MEETING_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

async function startCallAsHost(host: Page, label: string): Promise<void> {
  const trigger = host.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await pause(1000);
  }
  await dismissBrowserWarning(host);
  await trigger.click();

  const dialog = host.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await confirmButton.click();
}

// Bruno is the RECORDED user, so his join is deliberately paced (moveAndClick)
// so it reads clearly on the screencast.
async function joinCallAsGuest(guest: Page, label: string): Promise<void> {
  const trigger = guest.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await pause(1000);
  }
  await dismissBrowserWarning(guest);
  await moveAndClick(guest, trigger, 600);

  const dialog = guest.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await moveAndClick(guest, confirmButton, 600);
}

// Turns the camera off via the in-call toolbar, right after a party joins.
// The tile switches from the synthetic color-bar feed to a clean avatar
// (initials circle) as soon as Talk registers the track is off. Ana runs
// off-screen, so her toggle stays unpaced (plain click); Bruno is the
// RECORDED user, so his toggle is paced (moveAndClick) to read clearly.
async function disableCameraAsHost(host: Page): Promise<void> {
  const disableButton = host.getByRole('button', { name: 'Desativar vídeo' }).first();
  await disableButton.waitFor({ state: 'visible', timeout: 15000 });
  await disableButton.click();
  await host.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
}

async function disableCameraAsGuest(guest: Page): Promise<void> {
  const disableButton = guest.getByRole('button', { name: 'Desativar vídeo' }).first();
  await disableButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(guest, disableButton, 300);
  await guest.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
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
  const { context } = await login(browser, 'demo.bruno', CONFIG.demoUserPassword);
  return context;
}

async function record(brunoPage: Page): Promise<readonly Step[]> {
  await dismissBrowserWarning(brunoPage);

  // Ana is spawned in a separate context off the SAME browser instance, so
  // she inherits the fake-media launch flags too. She creates the meeting,
  // adds Bruno and starts the call so there is something for the RECORDED
  // user (Bruno) to join. Ana never appears on screen.
  const brunoBrowser = brunoPage.context().browser();
  if (!brunoBrowser) throw new Error('recorded context has no browser');
  const anaContext = await brunoBrowser.newContext({
    viewport: CONFIG.viewport,
    permissions: ['camera', 'microphone'],
  });
  const anaPage = await anaContext.newPage();
  await loginOnPage(anaPage, 'demo.ana', CONFIG.demoUserPassword);
  await anaPage.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(anaPage);

  await createMeetingAsHost(anaPage);
  await startCallAsHost(anaPage, 'Iniciar chamada');
  // Turn Ana's camera off promptly so she never renders as a color-bar
  // feed — her tile only ever exists for Bruno's (recorded) call.
  await disableCameraAsHost(anaPage);
  await pause(500);

  // Bruno's page was loaded before the conversation existed; reload so his
  // list reflects Ana's finished setup instead of polling for it live.
  await brunoPage.reload();
  await dismissBrowserWarning(brunoPage);

  const conversationEntry = brunoPage.getByRole('link', { name: new RegExp(MEETING_NAME) }).first();
  await conversationEntry.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await moveAndClick(brunoPage, conversationEntry, 600);

  await joinCallAsGuest(brunoPage, 'Entrar na chamada');
  await maskRealHost(brunoPage);
  // Turn Bruno's camera off right after joining — any color-bar frame
  // before this registers is brief, and the recorded "showcase" pause
  // happens later, once both tiles are clean avatars.
  await disableCameraAsGuest(brunoPage);
  await pause(300);

  await waitForCallParticipants(brunoPage, CALL_PARTICIPANT_COUNT, CALL_WAIT_TIMEOUT_MS);
  await maskRealHost(brunoPage);
  await pause(2000);

  await anaContext.close();

  return [
    {
      n: 1,
      text: `Abra o **Talk** e clique na conversa que mostra o aviso de chamada em andamento, com o botão **Entrar na chamada** (ex.: **${MEETING_NAME}**).`,
    },
    {
      n: 2,
      text: 'Clique em **Entrar na chamada** e confirme na tela de verificação de câmera e microfone, clicando em **Entrar na chamada** novamente.',
    },
    {
      n: 3,
      text: 'Você entra na chamada e aparece lado a lado com os demais participantes, prontos para conversar por vídeo.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'entrar-na-reuniao',
  title: 'Como entrar em uma reunião',
  description: 'Participe de uma chamada em andamento a partir da conversa ou de um link.',
  tip: 'Antes de entrar, dá pra testar a câmera e o microfone na tela de verificação.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
