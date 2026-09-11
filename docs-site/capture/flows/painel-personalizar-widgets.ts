import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const WIDGET_TO_ADD = 'Clima';
const WIDGET_TO_REMOVE = 'Menções na conversa';

// The real <input type="checkbox"> is visually hidden off-canvas by the
// widget-toggle component; the label is what the user actually sees and clicks.
function widgetLabel(page: Page, name: string) {
  return page.locator('label').filter({ hasText: name });
}

async function isWidgetChecked(page: Page, name: string): Promise<boolean> {
  const checkbox = page.getByRole('checkbox', { name, exact: true });
  await checkbox.waitFor({ state: 'visible', timeout: 10000 });
  return checkbox.isChecked();
}

// Unrecorded precondition: force the demo tenant's saved widget selection back
// to a known baseline before recording, so the toggles shown on camera are real
// state changes and not no-ops left over from a previous capture run.
async function resetWidgetPreconditions(page: Page): Promise<void> {
  const customizeButton = page.getByRole('button', { name: 'Personalizar', exact: true });
  await customizeButton.waitFor({ state: 'visible', timeout: 20000 });
  await customizeButton.click();

  const panelHeading = page.getByRole('heading', { name: 'Editar widgets', exact: true });
  await panelHeading.waitFor({ state: 'visible', timeout: 10000 });

  if (await isWidgetChecked(page, WIDGET_TO_ADD)) await widgetLabel(page, WIDGET_TO_ADD).click();
  if (!(await isWidgetChecked(page, WIDGET_TO_REMOVE))) await widgetLabel(page, WIDGET_TO_REMOVE).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await customizeButton.waitFor({ state: 'visible', timeout: 10000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/dashboard`);
  await resetWidgetPreconditions(page);
  return context;
}

async function openCustomizePanel(page: Page): Promise<void> {
  const customizeButton = page.getByRole('button', { name: 'Personalizar', exact: true });
  await customizeButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, customizeButton, 500);

  const panelHeading = page.getByRole('heading', { name: 'Editar widgets', exact: true });
  await panelHeading.waitFor({ state: 'visible', timeout: 10000 });
  await pause(600);
}

async function toggleWidget(page: Page, name: string): Promise<void> {
  await pause(300);
  await moveAndClick(page, widgetLabel(page, name), 500);
  await pause(400);
}

async function closeCustomizePanel(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: 'Fechar', exact: true });
  await pause(400);
  await moveAndClick(page, closeButton, 500);

  const customizeButton = page.getByRole('button', { name: 'Personalizar', exact: true });
  await customizeButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1000);
}

async function record(page: Page): Promise<readonly Step[]> {
  await openCustomizePanel(page);
  await toggleWidget(page, WIDGET_TO_ADD);
  await toggleWidget(page, WIDGET_TO_REMOVE);
  await closeCustomizePanel(page);

  return [
    { n: 1, text: 'Abra o **Painel** e clique em **Personalizar**, no rodapé da página.' },
    { n: 2, text: `No painel **Editar widgets**, marque um widget para adicioná-lo ao painel (ex.: **${WIDGET_TO_ADD}**).` },
    { n: 3, text: `Desmarque outro para removê-lo (ex.: **${WIDGET_TO_REMOVE}**) — a escolha é salva na hora.` },
    { n: 4, text: 'Clique em **Fechar** para voltar ao painel com os widgets atualizados.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'painel',
  slug: 'personalizar-widgets',
  title: 'Como personalizar o painel',
  description: 'Escolha quais widgets aparecem no seu painel inicial.',
  tip: 'Deixe no painel só o que você usa todo dia.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/dashboard`,
  setup,
  record,
};
