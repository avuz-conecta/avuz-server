import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const MEETING_NAME = 'Reunião Geral';
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
  const buttonNames = await page.getByRole('button').allInnerTexts();
  throw new Error(
    `BLOCKED: call never rendered ${tileCount} video tiles within ${timeoutMs}ms. Visible buttons: ${JSON.stringify(buttonNames)}`,
  );
}

async function openParticipantsPanel(host: Page): Promise<void> {
  const participantsTab = host.getByRole('tab', { name: /^Participantes/ });
  await participantsTab.waitFor({ state: 'visible', timeout: 15000 });
  await participantsTab.click();
}

async function openParticipantOptionsMenu(host: Page, participantName: string): Promise<void> {
  const participantRow = host.locator(`li[aria-label='Participante "${participantName}"']`);
  await participantRow.waitFor({ state: 'visible', timeout: 15000 });
  await participantRow.hover();

  const optionsButton = host.getByRole('button', { name: `Configurações para o participante "${participantName}"` });
  await optionsButton.click();
}

async function promoteParticipant(host: Page, participantName: string): Promise<void> {
  await host.getByRole('menuitem', { name: 'Promover a moderador' }).click();

  const participantRow = host.locator(`li[aria-label='Participante "${participantName}"']`);
  await participantRow.getByText('(moderador)').waitFor({ state: 'visible', timeout: 15000 });
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

  await startOrJoinCall(guest, 'Entrar na chamada', CALL_WAIT_TIMEOUT_MS);

  await waitForCallTiles(host, CALL_TILE_COUNT, CALL_WAIT_TIMEOUT_MS);
  await host.waitForTimeout(2000);

  await openParticipantsPanel(host);
  await host.waitForTimeout(1000);
  await shoot(host, framesDir, frame++);

  await openParticipantOptionsMenu(host, GUEST_DISPLAY_NAME);
  await host.waitForTimeout(500);
  await shoot(host, framesDir, frame++);

  await promoteParticipant(host, GUEST_DISPLAY_NAME);
  await host.waitForTimeout(500);
  await shoot(host, framesDir, frame++);

  const steps: readonly Step[] = [
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

  return {
    title: 'Como gerenciar participantes',
    description: 'Como moderador, promova, ajuste permissões ou remova participantes da reunião.',
    app: 'talk',
    slug: 'gerenciar-participantes',
    order: 7,
    media: 'gerenciar-participantes.mp4',
    tip: 'Quem organiza a conversa é moderador por padrão e pode promover outra pessoa a moderador.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
