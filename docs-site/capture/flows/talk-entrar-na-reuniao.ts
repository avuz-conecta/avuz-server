import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const MEETING_NAME = 'Reunião Semanal';
const GUEST_DISPLAY_NAME = 'Bruno Lima';
const CALL_WAIT_TIMEOUT_MS = 40000;
const CALL_TILE_COUNT = 2;

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createMeetingWithGuest(host: Page): Promise<void> {
  await host.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(host);
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

async function startOrJoinCall(page: Page, label: string, timeoutMs: number): Promise<void> {
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: timeoutMs });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await page.waitForTimeout(1000);
  }
  await dismissBrowserWarning(page);
  await trigger.click();

  const dialog = page.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: timeoutMs });
  await confirmButton.click();
}

async function waitForCallTiles(page: Page, tileCount: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visibleTiles = await page.locator('video').count();
    if (visibleTiles >= tileCount) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`BLOCKED: call never rendered ${tileCount} video tiles within ${timeoutMs}ms`);
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  let frame = 0;

  const { page: host } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await createMeetingWithGuest(host);
  await startOrJoinCall(host, 'Iniciar chamada', 15000);

  const { page: guest } = await login(browser, 'demo.bruno', CONFIG.demoUserPassword);
  await guest.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(guest);

  const conversationEntry = guest.getByRole('link', { name: new RegExp(MEETING_NAME) }).first();
  await conversationEntry.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await conversationEntry.click();

  const joinButton = guest.getByRole('button', { name: 'Entrar na chamada' }).first();
  await joinButton.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await shoot(guest, framesDir, frame++);

  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await joinButton.isDisabled())) break;
    await guest.waitForTimeout(1000);
  }
  await dismissBrowserWarning(guest);
  await joinButton.click();

  const joinDialog = guest.getByRole('dialog');
  const confirmJoin = joinDialog.getByRole('button', { name: 'Entrar na chamada' });
  await confirmJoin.waitFor({ state: 'visible', timeout: CALL_WAIT_TIMEOUT_MS });
  await shoot(guest, framesDir, frame++);
  await confirmJoin.click();

  await waitForCallTiles(guest, CALL_TILE_COUNT, CALL_WAIT_TIMEOUT_MS);
  await guest.waitForTimeout(2000);
  await shoot(guest, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como entrar em uma reunião',
    description: 'Participe de uma chamada em andamento a partir da conversa ou de um link.',
    app: 'talk',
    slug: 'entrar-na-reuniao',
    order: 3,
    media: 'entrar-na-reuniao.mp4',
    tip: 'Antes de entrar, dá pra testar a câmera e o microfone na tela de verificação.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
