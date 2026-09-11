import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, moveTo, pause } from '../lib/screencast';
import { maskRealHost } from '../lib/capture-helpers';
import type { Step } from '../lib/steps';

const CONVERSATION_NAME = 'Reunião de Projeto';
const PARTICIPANT_QUERY = 'Bruno';
const PARTICIPANT_NAME = 'Bruno Lima';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function moveAndForceClick(page: Page, locator: Locator, pauseMs = 400): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('moveAndForceClick: element has no bounding box (not visible?)');
  await moveTo(page, box);
  await pause(pauseMs);
  await locator.click({ force: true });
}

// Creates the conversation WITHOUT clicking the create dialog's own
// "Adicionar participantes" button. That button switches the dialog into a
// search-participants panel that briefly shows an unfiltered/recent list of
// every real user on the tenant before anything is typed — a privacy leak
// in a screencast. It's also redundant here: the actual invite of Bruno is
// demonstrated afterward via addParticipantBySearch() on the conversation's
// own Participants panel, so this dialog only needs the direct "Criando
// conversa" button once the name field is filled.
async function createConversation(page: Page): Promise<void> {
  const newConversationButton = page.getByRole('button', { name: 'Criar uma nova conversa' });
  await moveAndClick(page, newConversationButton, 600);

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(CONVERSATION_NAME);
  await pause(500);

  const createButton = createDialog.getByRole('button', { name: 'Criando conversa' });
  await moveAndClick(page, createButton, 600);
  await page.getByRole('heading', { name: CONVERSATION_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

// Types the participant query the INSTANT the search field appears — no
// pause beforehand. The Participants panel's "Procure ou adicione
// participantes" field shows an unfiltered/recent list of every real tenant
// user until a query narrows it, so any delay before filling it is a
// privacy leak in the recording. Filling immediately means only "Bruno
// Lima" (demo.bruno) is ever on screen.
async function addParticipantBySearch(page: Page): Promise<void> {
  const participantSearch = page.getByRole('textbox', { name: 'Procure ou adicione participantes' });
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await participantSearch.fill(PARTICIPANT_QUERY);

  const participantOption = page.getByRole('checkbox', { name: `Adicionar participante "${PARTICIPANT_NAME}"` });
  await participantOption.waitFor({ state: 'visible', timeout: 15000 });
  await pause(500);

  await moveAndForceClick(page, participantOption, 500);
  await page.getByRole('tab', { name: 'Participantes (2)' }).waitFor({ state: 'visible', timeout: 15000 });
  await pause(800);
}

async function copyConversationLink(page: Page): Promise<void> {
  await dismissBrowserWarning(page);
  const settingsButton = page.getByRole('button', { name: 'Configurações de conversa' });
  await moveAndClick(page, settingsButton, 600);

  const settingsDialog = page.getByRole('dialog', { name: 'Configurações de conversa' });
  await settingsDialog.waitFor({ state: 'visible', timeout: 10000 });

  const moderationLink = settingsDialog.getByRole('link', { name: 'Moderação' });
  await moveAndClick(page, moderationLink, 500);

  const guestLinkLabel = settingsDialog.getByText('Permitir que os convidados entrem nesta conversa por meio de um link');
  await guestLinkLabel.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, guestLinkLabel, 500);
  await page.locator('.toastify').getByText('Você permitiu convidados').waitFor({ state: 'visible', timeout: 10000 });
  await pause(600);

  const copyLinkButton = settingsDialog.getByRole('button', { name: 'Copiar link' });
  await moveAndForceClick(page, copyLinkButton, 600);
  await page
    .locator('.toastify')
    .getByText('Link da conversa copiado para a área de transferência')
    .waitFor({ state: 'visible', timeout: 10000 });
  await maskRealHost(page);
  await pause(1200);
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  // Clipboard permissions apply per-context, so they must be granted on the
  // recorded context itself (the unrecorded setup context is already closed).
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await dismissBrowserWarning(page);
  await createConversation(page);
  await pause(600);

  await addParticipantBySearch(page);
  await copyConversationLink(page);

  return [
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
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'talk',
  slug: 'convidar-participantes',
  title: 'Como convidar participantes',
  description: 'Adicione colegas a uma conversa ou envie o link para entrar na reunião.',
  tip: 'Participantes externos podem entrar na chamada só com o link, sem precisar de conta no AvuzConecta.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/spreed`,
  setup,
  record,
};
