import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Reunião Gravada';
const CONVERSATION_ACTIONS_LABEL = 'Ações de conversa';
const START_RECORDING_LABEL = 'Começar a gravar';
const RECORDING_STARTING_LABEL = 'Iniciando a gravação';
const RECORDING_INDICATOR_PAUSE_MS = 3500;

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

function findStartRecordingOption(page: Page) {
  return page.getByRole('menuitem', { name: START_RECORDING_LABEL });
}

async function openConversationActions(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: CONVERSATION_ACTIONS_LABEL, exact: true });
  await moveAndClick(page, trigger, 600);
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
  await pause(800);

  await moveAndClick(page, startRecordingOption, 600);
  await pause(RECORDING_INDICATOR_PAUSE_MS);
  const recordingStarted = await page
    .getByRole('button', { name: RECORDING_STARTING_LABEL })
    .isVisible()
    .catch(() => false);

  const startedStep: Step = recordingStarted
    ? {
        n: 4,
        text: 'A chamada passa a exibir o indicador **Iniciando a gravação** junto ao cronômetro, confirmando que a gravação foi solicitada.',
      }
    : {
        n: 4,
        text: 'A gravação é solicitada ao bot de gravação; se ele não estiver disponível no seu servidor, nenhum indicador aparece e a chamada continua normalmente sem gravar.',
      };

  return [
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
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  app: 'talk',
  slug: 'gravar-reuniao',
  title: 'Como gravar uma reunião',
  description: 'Grave a chamada para quem não pôde participar — só o organizador pode iniciar.',
  tip: 'Avise os participantes antes de gravar a chamada; a gravação fica disponível para todos assistirem depois.',
  order: 10,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
