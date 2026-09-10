import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Reunião de alinhamento';

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
  await pause(1300);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await moveAndClick(page, saveButton, 500);

  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra a **Agenda** e clique em **Criar novo evento**.' },
    { n: 2, text: `Digite um título para o evento (ex.: **${EVENT_TITLE}**).` },
    { n: 3, text: 'Confira a data e o horário preenchidos e clique em **Salvar**.' },
    { n: 4, text: 'O evento é criado na hora e aparece no calendário, no dia e horário escolhidos.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'criar-evento',
  title: 'Como criar um evento',
  description: 'Marque compromissos e reuniões na sua Agenda.',
  tip: 'Clique direto num horário do calendário para criar um evento rápido.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
