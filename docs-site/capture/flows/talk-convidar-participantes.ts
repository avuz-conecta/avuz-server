import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const CONVERSATION_NAME = 'Reunião de Projeto';
const PARTICIPANT_QUERY = 'Bruno';
const PARTICIPANT_NAME = 'Bruno Lima';

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

async function addParticipantBySearch(page: Page, framesDir: string, frame: number): Promise<number> {
  let nextFrame = frame;

  const participantSearch = page.getByRole('textbox', { name: 'Procure ou adicione participantes' });
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, nextFrame++);

  await participantSearch.fill(PARTICIPANT_QUERY);
  const participantOption = page.getByRole('checkbox', { name: `Adicionar participante "${PARTICIPANT_NAME}"` });
  await participantOption.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, nextFrame++);

  await participantOption.click({ force: true });
  await page.getByRole('tab', { name: 'Participantes (2)' }).waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, nextFrame++);

  return nextFrame;
}

async function copyConversationLink(page: Page, framesDir: string, frame: number): Promise<number> {
  let nextFrame = frame;

  await dismissBrowserWarning(page);
  await page.getByRole('button', { name: 'Configurações de conversa' }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Configurações de conversa' });
  await settingsDialog.waitFor({ state: 'visible', timeout: 10000 });

  await settingsDialog.getByRole('link', { name: 'Moderação' }).click();
  const guestLinkLabel = settingsDialog.getByText('Permitir que os convidados entrem nesta conversa por meio de um link');
  await guestLinkLabel.waitFor({ state: 'visible', timeout: 10000 });
  await guestLinkLabel.click();
  await page.locator('.toastify').getByText('Você permitiu convidados').waitFor({ state: 'visible', timeout: 10000 });

  await settingsDialog.getByRole('button', { name: 'Copiar link' }).click({ force: true });
  await page
    .locator('.toastify')
    .getByText('Link da conversa copiado para a área de transferência')
    .waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, nextFrame++);

  return nextFrame;
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  let frame = 0;
  await createConversation(page);

  frame = await addParticipantBySearch(page, framesDir, frame);
  frame = await copyConversationLink(page, framesDir, frame);

  const steps: readonly Step[] = [
    {
      n: 1,
      text: `Abra o **Talk**, clique em **Criar uma nova conversa**: dê um nome como **${CONVERSATION_NAME}** e confirme em **Criando conversa**.`,
    },
    {
      n: 2,
      text: `No painel **Participantes**, digite o nome da pessoa (ex.: **${PARTICIPANT_QUERY}**) no campo **Procure ou adicione participantes** e selecione **${PARTICIPANT_NAME}** na lista de resultados.`,
    },
    {
      n: 3,
      text: `A pessoa é adicionada na hora e aparece na lista de **Participantes**, com acesso direto à conversa.`,
    },
    {
      n: 4,
      text: 'Para convidar por link, abra **Configurações de conversa** > **Moderação**, ative **Permitir que os convidados entrem nesta conversa por meio de um link** e clique em **Copiar link**: o endereço é copiado, pronto para enviar por e-mail ou mensagem.',
    },
  ];

  return {
    title: 'Como convidar participantes',
    description: 'Adicione colegas a uma conversa ou envie o link para entrar na reunião.',
    app: 'talk',
    slug: 'convidar-participantes',
    order: 2,
    media: 'convidar-participantes.mp4',
    tip: 'Participantes externos podem entrar na chamada só com o link, sem precisar de conta no AvuzConecta.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
