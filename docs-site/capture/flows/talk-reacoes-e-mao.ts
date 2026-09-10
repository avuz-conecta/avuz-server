import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

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

async function startCall(page: Page): Promise<void> {
  const label = 'Iniciar chamada';
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await page.waitForTimeout(1000);
  }
  await dismissBrowserWarning(page);
  await trigger.click();

  const dialog = page.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: 20000 });
  await confirmButton.click();
}

async function openReactionPicker(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enviar reação' }).click();
}

async function sendClapReaction(page: Page): Promise<void> {
  // The emoji picker items expose an accessible role of "menuitem", not "button".
  await page.getByRole('menuitem', { name: CLAP_REACTION_LABEL }).click();
}

async function toggleRaiseHand(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label }).click();
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  let frame = 0;

  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await createConversation(page);
  await startCall(page);
  await page.waitForTimeout(3000);
  await shoot(page, framesDir, frame++);

  await openReactionPicker(page);
  await page.getByRole('menuitem', { name: CLAP_REACTION_LABEL }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await sendClapReaction(page);
  await page.waitForTimeout(800);
  await shoot(page, framesDir, frame++);

  await toggleRaiseHand(page, RAISE_HAND_LABEL);
  await page.getByRole('button', { name: LOWER_HAND_LABEL }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como usar reações e levantar a mão',
    description: 'Reaja com emojis ou levante a mão para pedir a palavra sem interromper.',
    app: 'talk',
    slug: 'reacoes-e-mao',
    order: 9,
    media: 'reacoes-e-mao.mp4',
    tip: 'Levantar a mão avisa quem organiza a chamada que você quer falar, sem precisar interromper.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
