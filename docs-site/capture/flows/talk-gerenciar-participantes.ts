import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login, loginOnPage } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const MEETING_NAME = 'Reunião Geral';
const GUEST_DISPLAY_NAME = 'Bruno Lima';
const CALL_WAIT_TIMEOUT_MS = 40000;
const CALL_PARTICIPANT_COUNT = 2;

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createMeetingWithGuest(host: Page): Promise<void> {
  const newConversationButton = host.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(host, newConversationButton, 350);

  const createDialog = host.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(MEETING_NAME);
  await pause(300);

  const addParticipantsButton = createDialog.getByRole('button', { name: 'Adicionar participantes' });
  await moveAndClick(host, addParticipantsButton, 300);

  const participantSearch = createDialog.getByLabel('Procurar participantes');
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await participantSearch.fill('demo.bruno');

  const brunoOption = createDialog.getByText(GUEST_DISPLAY_NAME).first();
  await brunoOption.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(host, brunoOption, 300);

  const createButton = createDialog.getByRole('button', { name: 'Criando conversa' });
  await moveAndClick(host, createButton, 350);
  await host.getByRole('heading', { name: MEETING_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

async function startOrJoinCall(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await pause(1000);
  }
  await dismissBrowserWarning(page);
  await moveAndClick(page, trigger, 350);

  const dialog = page.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: 20000 });
  await moveAndClick(page, confirmButton, 350);
}

// Turns the camera off via the in-call toolbar, right after a party joins.
// The tile switches from the synthetic color-bar feed to a clean avatar
// (initials circle) as soon as Talk registers the track is off.
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

async function openParticipantsPanel(host: Page): Promise<void> {
  const participantsTab = host.getByRole('tab', { name: /^Participantes/ });
  await participantsTab.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(host, participantsTab, 350);
}

async function openParticipantOptionsMenu(host: Page, participantName: string): Promise<void> {
  const participantRow = host.locator(`li[aria-label='Participante "${participantName}"']`);
  await participantRow.waitFor({ state: 'visible', timeout: 15000 });
  await participantRow.hover();
  await pause(200);

  const optionsButton = host.getByRole('button', { name: `Configurações para o participante "${participantName}"` });
  await moveAndClick(host, optionsButton, 350);
}

async function promoteParticipant(host: Page, participantName: string): Promise<void> {
  const promoteMenuItem = host.getByRole('menuitem', { name: 'Promover a moderador' });
  await moveAndClick(host, promoteMenuItem, 350);

  const participantRow = host.locator(`li[aria-label='Participante "${participantName}"']`);
  await participantRow.getByText('(moderador)').waitFor({ state: 'visible', timeout: 15000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(anaPage: Page): Promise<readonly Step[]> {
  await dismissBrowserWarning(anaPage);
  await createMeetingWithGuest(anaPage);
  await pause(300);

  await startOrJoinCall(anaPage, 'Iniciar chamada');
  await maskRealHost(anaPage);
  // Turn the camera off promptly — any color-bar frame before this registers
  // is brief, and the recorded "showcase" pause happens later, once both
  // parties' tiles are clean avatars.
  await disableCameraInCall(anaPage);
  await pause(300);

  // Bruno joins from a separate context spawned off the SAME browser
  // instance, so it inherits the fake-media launch flags (synthetic camera
  // feed) just like Ana's recorded context.
  const anaBrowser = anaPage.context().browser();
  if (!anaBrowser) throw new Error('recorded context has no browser');
  const brunoContext = await anaBrowser.newContext({
    viewport: CONFIG.viewport,
    permissions: ['camera', 'microphone'],
  });
  const brunoPage = await brunoContext.newPage();
  await loginOnPage(brunoPage, 'demo.bruno', CONFIG.demoUserPassword);
  await brunoPage.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(brunoPage);

  const conversationEntry = brunoPage.getByRole('link', { name: new RegExp(MEETING_NAME) }).first();
  await conversationEntry.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await conversationEntry.click();

  await startOrJoinCall(brunoPage, 'Entrar na chamada');
  await disableCameraInCall(brunoPage);

  await waitForCallParticipants(anaPage, CALL_PARTICIPANT_COUNT, CALL_WAIT_TIMEOUT_MS);
  await maskRealHost(anaPage);
  await pause(500);

  await openParticipantsPanel(anaPage);
  await pause(300);

  await openParticipantOptionsMenu(anaPage, GUEST_DISPLAY_NAME);
  await pause(400);

  await promoteParticipant(anaPage, GUEST_DISPLAY_NAME);
  await pause(500);

  await brunoContext.close();

  return [
    {
      n: 1,
      text: 'Durante uma chamada, clique na aba **Participantes** para ver quem está na reunião.',
    },
    {
      n: 2,
      text: `Passe o mouse sobre o nome de quem você quer moderar (ex.: **${GUEST_DISPLAY_NAME}**) e clique no botão **Configurações para o participante** que aparece na linha da pessoa.`,
    },
    {
      n: 3,
      text: 'No menu, escolha **Promover a moderador** para dividir a moderação, ou **Remover participante** para tirar alguém da chamada; **Editar permissões** controla o que a pessoa pode fazer.',
    },
    {
      n: 4,
      text: `A pessoa promovida passa a aparecer como **(moderador)** na lista de participantes, com os mesmos poderes de moderação que você.`,
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'gerenciar-participantes',
  title: 'Como gerenciar participantes',
  description: 'Como moderador, promova, ajuste permissões ou remova participantes da reunião.',
  tip: 'Quem organiza a conversa é moderador por padrão e pode promover outra pessoa a moderador.',
  order: 7,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
