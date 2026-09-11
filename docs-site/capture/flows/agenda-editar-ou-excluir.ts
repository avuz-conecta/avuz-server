import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Reunião de equipe';
const UPDATED_TITLE = 'Reunião de equipe (adiada)';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/calendar`);

  const newEventButton = page.getByRole('button', { name: 'Criar novo evento' });
  await newEventButton.waitFor({ state: 'visible', timeout: 20000 });
  await newEventButton.click();

  const titleField = page.getByPlaceholder('Título do evento');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await titleField.fill(EVENT_TITLE);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await saveButton.click();

  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });

  return context;
}

// The event popover (read-only view, edit form, and the "..." actions menu
// trigger) all live under one ".event-popover" container regardless of
// state — it carries no role="dialog", so scoping through this class is the
// reliable way to avoid colliding with the toolbar's own "Ações" button.
async function record(page: Page): Promise<readonly Step[]> {
  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, eventChip, 600);

  const popover = page.locator('.event-popover');
  const editButton = popover.getByRole('button', { name: 'Editar' });
  await editButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, editButton, 500);

  const titleField = popover.getByPlaceholder('Título do evento');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await titleField.fill(UPDATED_TITLE);
  await pause(800);

  const updateButton = popover.getByRole('button', { name: 'Atualizar' });
  await moveAndClick(page, updateButton, 500);

  const updatedChip = page.getByText(UPDATED_TITLE).first();
  await updatedChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  await moveAndClick(page, updatedChip, 600);

  const actionsButton = popover.getByRole('button', { name: 'Ações' });
  await actionsButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, actionsButton, 500);

  const deleteItem = page.getByRole('menuitem', { name: 'Excluir', exact: true });
  await deleteItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(700);
  await moveAndClick(page, deleteItem, 500);

  await updatedChip.waitFor({ state: 'hidden', timeout: 15000 });
  await pause(1200);

  return [
    { n: 1, text: `Na Agenda, clique no evento **${EVENT_TITLE}** para abri-lo.` },
    { n: 2, text: 'Clique em **Editar** para alterar os detalhes do evento.' },
    { n: 3, text: `Altere o título (ex.: **${UPDATED_TITLE}**) e clique em **Atualizar**.` },
    { n: 4, text: 'O evento é salvo com o novo título. Clique nele novamente para abri-lo.' },
    { n: 5, text: 'Clique em **Ações** e escolha **Excluir**.' },
    { n: 6, text: 'O evento é removido na hora e some do calendário.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'editar-ou-excluir',
  title: 'Como editar ou excluir um evento',
  description: 'Altere os detalhes de um evento ou remova-o da sua Agenda.',
  tip: 'Ao editar um evento recorrente, você escolhe se muda só aquele ou toda a série.',
  order: 8,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
