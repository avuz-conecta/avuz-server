import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Reunião de Equipe';
const CLAP_REACTION_LABEL = 'Reagir com 👏';
const RAISE_HAND_LABEL = 'Levantar a mão (R)';
const LOWER_HAND_LABEL = 'Abaixar a mão (R)';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

// Creates a solo conversation WITHOUT ever opening the "Adicionar
// participantes" picker. That picker lists every real user on the tenant,
// which is a privacy leak in a screencast — this flow showcases reactions
// and raise-hand, not participants, so a solo conversation is enough. The
// name-entry dialog already exposes a direct "Criando conversa" button once
// the name field is filled; clicking it skips the picker entirely. (Found
// while re-capturing this flow for the camera-timing fix below — the old
// two-step Adicionar-participantes flow flashed the tenant's real user list.)
async function createConversation(page: Page): Promise<void> {
  const newConversationButton = page.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(page, newConversationButton, 600);

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  // Fill instantly (not typed): with the mouse stationary, per-key typing is a
  // tiny frame delta that reads as a frozen frame to freezedetect, so it only
  // lengthens the static window. Instant fill keeps the name-entry near zero.
  await nameField.fill(CONVERSATION_NAME);
  await pause(300);

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

// Turns the camera off via the in-call toolbar, right after joining. The
// tile switches from the synthetic color-bar feed to a clean avatar
// (initials circle) as soon as Talk registers the track is off — same
// pattern as talk-iniciar-reuniao.ts's disableCameraInCall. The showcase
// (reaction + raise hand) happens after this, so no bars are recorded.
async function disableCameraInCall(page: Page): Promise<void> {
  const disableButton = page.getByRole('button', { name: 'Desativar vídeo' }).first();
  await disableButton.waitFor({ state: 'visible', timeout: 15000 });
  await moveAndClick(page, disableButton, 300);
  await page.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
}

async function openReactionPicker(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Enviar reação' });
  await moveAndClick(page, trigger, 350);
}

async function sendClapReaction(page: Page): Promise<void> {
  // The emoji picker items expose an accessible role of "menuitem", not "button".
  const reaction = page.getByRole('menuitem', { name: CLAP_REACTION_LABEL });
  await moveAndClick(page, reaction, 350);
}

async function toggleRaiseHand(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: label });
  await moveAndClick(page, button, 350);
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
  await disableCameraInCall(page);
  // Camera-off scenes are static avatar frames, so a hold over ~1s reads as a
  // frozen screen. Keep the payoff holds short (~0.9s) — enough to register
  // the state change without freezing.
  await pause(900);

  await openReactionPicker(page);
  await page.getByRole('menuitem', { name: CLAP_REACTION_LABEL }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(900);

  await sendClapReaction(page);
  await pause(900);

  await toggleRaiseHand(page, RAISE_HAND_LABEL);
  await page.getByRole('button', { name: LOWER_HAND_LABEL }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(900);

  return [
    {
      n: 1,
      text: `Entre em uma chamada no **Talk**: crie uma conversa como **${CONVERSATION_NAME}** e clique em **Iniciar chamada**.`,
    },
    {
      n: 2,
      text: 'Na barra de controles da chamada, clique em **Enviar reação** para abrir a seleção de emojis.',
    },
    {
      n: 3,
      text: 'Escolha um emoji, como **👏**, para reagir; ele aparece para os outros participantes por alguns segundos.',
    },
    {
      n: 4,
      text: 'Clique em **Levantar a mão** para avisar que quer falar; o botão passa a mostrar **Abaixar a mão**, que você usa para baixá-la de novo.',
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'reacoes-e-mao',
  title: 'Como usar reações e levantar a mão',
  description: 'Reaja com emojis ou levante a mão para pedir a palavra sem interromper.',
  tip: 'Levantar a mão avisa quem organiza a chamada que você quer falar, sem precisar interromper.',
  order: 9,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
