import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Consulta médica';
const REMINDER_LABEL = '10 minutos antes';

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

  const moreDetailsButton = page.getByRole('button', { name: 'Mais detalhes' });
  await moveAndClick(page, moreDetailsButton, 500);

  // The compact popover has no reminder control — it only appears in the full
  // editor opened by "Mais detalhes", as an "Adicionar lembrete" dropdown
  // with preset offsets (5/10/15/30 min, 1/2h, 1/2 days before the event).
  const reminderField = page.getByPlaceholder('Adicionar lembrete');
  await reminderField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, reminderField, 500);

  const reminderOption = page.getByText(REMINDER_LABEL, { exact: false }).first();
  await reminderOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, reminderOption, 600);

  const reminderRow = page.getByText('10 minutos antes de iniciar o evento', { exact: false });
  await reminderRow.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1000);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await moveAndClick(page, saveButton, 500);

  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  return [
    { n: 1, text: 'Abra a **Agenda** e clique em **Criar novo evento**.' },
    { n: 2, text: `Digite um título para o evento (ex.: **${EVENT_TITLE}**).` },
    { n: 3, text: 'Clique em **Mais detalhes** para abrir as opções completas do evento.' },
    {
      n: 4,
      text: 'Clique em **Adicionar lembrete** e escolha, por exemplo, **10 minutos antes de iniciar o evento**.',
    },
    { n: 5, text: 'O lembrete escolhido aparece na lista. Clique em **Salvar** para confirmar.' },
    { n: 6, text: 'Você recebe um aviso no horário definido, antes do evento começar.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'lembretes',
  title: 'Como definir lembretes',
  description: 'Receba um aviso antes do evento para não esquecer.',
  tip: 'Você pode adicionar mais de um lembrete no mesmo evento.',
  order: 5,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
