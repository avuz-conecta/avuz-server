import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Reunião de Projeto';
const PARTICIPANT_QUERY = 'Bruno';
const PARTICIPANT_NAME = 'Bruno Lima';
const PARTICIPANT_UID = 'demo.bruno';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const newEventButton = page.getByRole('button', { name: 'Criar novo evento' });
  await newEventButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newEventButton, 500);

  const titleField = page.getByPlaceholder('Título do evento');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await titleField.fill(EVENT_TITLE);
  await pause(800);

  const participantSearch = page.getByRole('combobox', {
    name: 'Pesquise e-mails, usuários, contatos, grupos de contatos ou equipes',
  });
  await moveAndClick(page, participantSearch, 500);

  // Typing then selecting must stay tight: the participant dropdown auto-closes
  // if there is a pause between filling the query and clicking the option.
  await participantSearch.fill(PARTICIPANT_QUERY);
  const participantOption = page.getByRole('option').filter({ hasText: PARTICIPANT_UID });
  await participantOption.click({ timeout: 10000 });

  const addedParticipant = page.getByText(PARTICIPANT_NAME).first();
  await addedParticipant.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await moveAndClick(page, saveButton, 500);

  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra a **Agenda** e clique em **Criar novo evento**.' },
    { n: 2, text: `Digite um título para o evento (ex.: **${EVENT_TITLE}**).` },
    {
      n: 3,
      text: `Em **Participantes**, digite o nome da pessoa (ex.: **${PARTICIPANT_QUERY}**) no campo de busca e selecione **${PARTICIPANT_NAME}** na lista de resultados.`,
    },
    {
      n: 4,
      text: `Clique em **Salvar**: **${PARTICIPANT_NAME}** é adicionada ao evento e recebe o convite para confirmar presença.`,
    },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'convidar-participantes',
  title: 'Como convidar participantes',
  description: 'Convide pessoas para um evento — elas recebem o convite e podem confirmar presença.',
  tip: 'Quem é convidado recebe o evento na própria Agenda.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
