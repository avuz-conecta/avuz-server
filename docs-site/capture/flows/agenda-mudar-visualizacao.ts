import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLES = ['Reunião', 'Almoço', 'Revisão'];

async function createQuickEvent(page: Page, title: string): Promise<void> {
  const newEventButton = page.getByRole('button', { name: 'Criar novo evento' });
  await newEventButton.waitFor({ state: 'visible', timeout: 20000 });
  await newEventButton.click();

  const titleField = page.getByPlaceholder('Título do evento');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await titleField.fill(title);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await saveButton.click();

  const eventChip = page.getByText(title).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/calendar`);
  for (const title of EVENT_TITLES) {
    await createQuickEvent(page, title);
  }
  return context;
}

// The top toolbar has no visible "Dia/Semana/Mês" buttons — the view
// switcher is a single icon-only button (accessible name "Ações", shared
// with other tertiary menu toggles elsewhere on the page) that opens a menu
// with Dia/Semana/Mês/Ano/Lista as menuitems. .first() picks the toolbar
// one, which is always the first "Ações" button in DOM order.
async function openViewMenu(page: Page): Promise<void> {
  const viewSwitcher = page.getByRole('button', { name: 'Ações', exact: true }).first();
  await viewSwitcher.waitFor({ state: 'visible', timeout: 20000 });
  await moveAndClick(page, viewSwitcher, 500);
}

async function switchTo(page: Page, viewLabel: string): Promise<void> {
  await openViewMenu(page);
  const viewOption = page.getByRole('menuitem', { name: viewLabel, exact: true });
  await viewOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, viewOption, 800);
}

async function record(page: Page): Promise<readonly Step[]> {
  const monthGrid = page.getByText('dom').first();
  await monthGrid.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  await switchTo(page, 'Semana');
  await pause(1200);

  await switchTo(page, 'Dia');
  await pause(1400);

  return [
    { n: 1, text: 'Abra a **Agenda**. Por padrão, ela abre na visualização de **Mês**.' },
    { n: 2, text: 'Clique no ícone de visualização, ao lado de **Hoje**, e escolha **Semana**.' },
    { n: 3, text: 'A Agenda passa a mostrar os compromissos organizados por dia da semana.' },
    { n: 4, text: 'Abra o ícone de visualização novamente e escolha **Dia**.' },
    { n: 5, text: 'A Agenda mostra agora só os compromissos do dia, hora a hora.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'mudar-visualizacao',
  title: 'Como mudar a visualização',
  description: 'Veja seus compromissos por dia, semana ou mês conforme a necessidade.',
  tip: 'A visão de semana é ótima para planejar; a de mês, para ter o panorama.',
  order: 7,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
