import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CALENDAR_NAME = 'Pessoal';
const RECIPIENT_QUERY = 'Bruno';
const RECIPIENT_NAME = 'Bruno Lima';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function openShareDialog(page: Page): Promise<void> {
  // The share control only shows up on hover, as a pencil "Editar e
  // compartilhar calendário" icon next to the calendar entry — there is no
  // separate "..." menu. Its accessible name is unique to writable
  // calendars, so it targets Pessoal without needing to scope by row.
  // The icon is display:none until the row is actually hovered, so it must
  // be revealed with a real hover before moveAndClick can read its box.
  const calendarLink = page.getByRole('link', { name: CALENDAR_NAME, exact: true });
  await calendarLink.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await calendarLink.hover();

  const editButton = page.getByRole('button', { name: 'Editar e compartilhar calendário' });
  await editButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, editButton, 500);

  const dialogHeading = page.getByRole('heading', { name: 'Editar calendário' });
  await dialogHeading.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
}

async function shareCalendarWithBruno(page: Page): Promise<void> {
  const shareSearch = page.getByRole('combobox', { name: 'Compartilhar com usuários ou grupos' });
  await shareSearch.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, shareSearch, 400);
  await shareSearch.fill(RECIPIENT_QUERY);

  // Typing then selecting must stay tight: the search dropdown auto-closes
  // if there is a pause between filling the query and clicking the option.
  const shareOption = page.getByRole('option').filter({ hasText: RECIPIENT_NAME });
  await shareOption.click({ timeout: 10000 });

  const editPermissionLabel = page.locator('label').filter({ hasText: 'pode editar e ver eventos confidenciais' });
  await editPermissionLabel.waitFor({ state: 'visible', timeout: 10000 });
  await pause(800);
}

async function grantEditPermission(page: Page): Promise<void> {
  // NcCheckboxRadioSwitch renders the real <input type="checkbox"> visually
  // hidden off-canvas — the clickable surface is its <label for="...">.
  const editPermissionLabel = page.locator('label').filter({ hasText: 'pode editar e ver eventos confidenciais' });
  await moveAndClick(page, editPermissionLabel, 500);
  await pause(800);
}

async function saveAndClose(page: Page): Promise<void> {
  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await moveAndClick(page, saveButton, 500);

  const dialogHeading = page.getByRole('heading', { name: 'Editar calendário' });
  await dialogHeading.waitFor({ state: 'hidden', timeout: 10000 });
  await pause(1000);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openShareDialog(page);
  await shareCalendarWithBruno(page);
  await grantEditPermission(page);
  await saveAndClose(page);

  return [
    { n: 1, text: `Passe o mouse sobre o calendário **${CALENDAR_NAME}**, na barra lateral, e clique no ícone **Editar e compartilhar calendário**.` },
    {
      n: 2,
      text: `Em **Compartilhar calendário**, digite o nome da pessoa (ex.: **${RECIPIENT_QUERY}**) e selecione **${RECIPIENT_NAME}** na lista.`,
    },
    { n: 3, text: `**${RECIPIENT_NAME}** aparece na lista de compartilhamento. Marque **pode editar e ver eventos confidenciais** para permitir que ela altere os eventos.` },
    { n: 4, text: 'Clique em **Salvar** para confirmar o compartilhamento.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'compartilhar-calendario',
  title: 'Como compartilhar um calendário',
  description: 'Deixe colegas verem ou editarem os eventos de um calendário seu.',
  tip: 'Compartilhe o calendário da equipe para todos verem os mesmos compromissos.',
  order: 6,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
