import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Reunião semanal';

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

  // The compact popover has no recurrence control — it only appears in the
  // full editor opened by "Mais detalhes", as a "Não se repete" row with a
  // pencil "Editar" button.
  const repeatEditButton = page.getByRole('button', { name: 'Editar' });
  await repeatEditButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, repeatEditButton, 500);

  // Opens a "Repetir evento" dialog with a frequency dropdown defaulted to
  // "nunca" (nunca/dia/semana/mês/ano).
  const weeklyOption = page.getByText('semana', { exact: true });
  await weeklyOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, weeklyOption, 600);

  const addRepeatButton = page.getByRole('button', { name: 'Adicionar', exact: true });
  await pause(600);
  await moveAndClick(page, addRepeatButton, 500);

  const repeatSummary = page.getByText('Semanalmente', { exact: false });
  await repeatSummary.waitFor({ state: 'visible', timeout: 10000 });
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
      text: 'Ao lado de **Não se repete**, clique no ícone de editar e escolha **semana** para repetir toda semana.',
    },
    { n: 5, text: 'Clique em **Adicionar** para confirmar a recorrência e depois em **Salvar**.' },
    { n: 6, text: 'O evento passa a aparecer no mesmo dia e horário, toda semana, no calendário.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'evento-recorrente',
  title: 'Como criar um evento recorrente',
  description: 'Crie eventos que se repetem (diária, semanal ou mensalmente) sem recriar toda vez.',
  tip: 'Use recorrência para reuniões fixas, como a reunião semanal da equipe.',
  order: 4,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
