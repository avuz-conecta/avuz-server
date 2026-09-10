import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const CONVERSATION_NAME = 'Reunião Gravada';
const CONVERSATION_ACTIONS_LABEL = 'Ações de conversa';
const START_RECORDING_LABEL = 'Começar a gravar';
const RECORDING_STARTING_LABEL = 'Iniciando a gravação';
const RECORDING_POLL_TIMEOUT_MS = 40000;
const RECORDING_POLL_INTERVAL_MS = 2000;

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

async function openConversationActions(page: Page): Promise<void> {
  await page.getByRole('button', { name: CONVERSATION_ACTIONS_LABEL, exact: true }).click();
}

function findStartRecordingOption(page: Page) {
  return page.getByRole('menuitem', { name: START_RECORDING_LABEL });
}

async function clickStartRecording(page: Page): Promise<void> {
  await findStartRecordingOption(page).click();
}

async function waitForRecordingIndicator(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isStarting = await page
      .getByRole('button', { name: RECORDING_STARTING_LABEL })
      .isVisible()
      .catch(() => false);
    if (isStarting) return true;
    await page.waitForTimeout(RECORDING_POLL_INTERVAL_MS);
  }
  return false;
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  let frame = 0;

  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await createConversation(page);
  await startCall(page);
  await page.waitForTimeout(3000);
  await shoot(page, framesDir, frame++);

  await openConversationActions(page);
  const startRecordingOption = findStartRecordingOption(page);
  const hasStartRecording = await startRecordingOption
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!hasStartRecording) {
    const menuItems = await page.getByRole('menuitem').allTextContents();
    throw new Error(
      `BLOCKED: no recording option found in the "${CONVERSATION_ACTIONS_LABEL}" menu. Menu items present: ${menuItems.join(', ')}`,
    );
  }
  await shoot(page, framesDir, frame++);

  await clickStartRecording(page);
  const recordingStarted = await waitForRecordingIndicator(page, RECORDING_POLL_TIMEOUT_MS);
  await shoot(page, framesDir, frame++);

  const startedStep: Step = recordingStarted
    ? {
        n: 4,
        text: 'A chamada passa a exibir o indicador **Iniciando a gravação** junto ao cronômetro, confirmando que a gravação foi solicitada.',
      }
    : {
        n: 4,
        text: 'A gravação é solicitada ao bot de gravação; se ele não estiver disponível no seu servidor, nenhum indicador aparece e a chamada continua normalmente sem gravar.',
      };

  const steps: readonly Step[] = [
    {
      n: 1,
      text: `Entre em uma chamada no **Talk** como organizador: crie uma conversa como **${CONVERSATION_NAME}** e clique em **Iniciar chamada**.`,
    },
    {
      n: 2,
      text: `No cabeçalho da chamada, clique em **${CONVERSATION_ACTIONS_LABEL}** (ícone "···") para abrir o menu de opções.`,
    },
    {
      n: 3,
      text: `Clique em **${START_RECORDING_LABEL}** para pedir o início da gravação. Só quem organiza a chamada vê essa opção.`,
    },
    startedStep,
  ];

  return {
    title: 'Como gravar uma reunião',
    description: 'Grave a chamada para quem não pôde participar — só o organizador pode iniciar.',
    app: 'talk',
    slug: 'gravar-reuniao',
    order: 10,
    media: 'gravar-reuniao.mp4',
    tip: 'Avise os participantes antes de gravar a chamada; a gravação fica disponível para todos assistirem depois.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
