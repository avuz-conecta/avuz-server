import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const LOCATION_FIELD_ID = 'account-property-address';
const ORGANISATION_FIELD_ID = 'account-property-organisation';
const ROLE_FIELD_ID = 'account-property-role';

const LOCATION_VALUE = 'São Paulo';
const ORGANISATION_VALUE = 'Conecta Demo';
const ROLE_VALUE = 'Gerente de Projetos';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

// Personal-info fields save through savePrimaryAccountProperty(), which calls
// @nextcloud/password-confirmation's confirmPassword() on every request. A
// freshly logged-in session (setup() just authenticated) stays within sudo
// mode and this resolves silently — but if the instance ever prompts anyway,
// handle it the same way lib/browser.ts's loginOnPage() already does.
async function confirmPasswordIfPrompted(page: Page): Promise<void> {
  const passwordField = page.getByLabel('Senha', { exact: true });
  const promptVisible = await passwordField.isVisible().catch(() => false);
  if (!promptVisible) return;

  await passwordField.fill(CONFIG.demoUserPassword);
  const confirmButton = page.getByRole('button', { name: 'Confirmar', exact: true });
  await moveAndClick(page, confirmButton, 400);
  await passwordField.waitFor({ state: 'hidden', timeout: 10000 });
}

// AccountPropertySection.vue toggles an `input-field--success` class on the
// field's wrapper for 2s once the autosave PUT resolves — that's the
// checkmark the user sees next to the field.
async function waitForAutosaveCheckmark(page: Page, fieldId: string): Promise<void> {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.closest('.input-field')?.classList.contains('input-field--success') ?? false,
    fieldId,
    { timeout: 8000 },
  );
}

async function fillProfileField(page: Page, fieldId: string, value: string): Promise<void> {
  const field = page.locator(`#${fieldId}`);
  await field.scrollIntoViewIfNeeded();
  await pause(400);
  await moveAndClick(page, field, 400);
  await field.fill(value);
  await pause(1300);
  await confirmPasswordIfPrompted(page);
  await waitForAutosaveCheckmark(page, fieldId);
  await pause(800);
}

async function record(page: Page): Promise<readonly Step[]> {
  const locationField = page.locator(`#${LOCATION_FIELD_ID}`);
  await locationField.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  await fillProfileField(page, LOCATION_FIELD_ID, LOCATION_VALUE);
  await fillProfileField(page, ORGANISATION_FIELD_ID, ORGANISATION_VALUE);
  await fillProfileField(page, ROLE_FIELD_ID, ROLE_VALUE);

  await pause(1000);

  return [
    { n: 1, text: `Em **Minha conta**, preencha **Localização** com sua cidade — por exemplo, **${LOCATION_VALUE}**.` },
    { n: 2, text: `Role até **Detalhes** e preencha **Organização** com o nome da empresa — por exemplo, **${ORGANISATION_VALUE}**.` },
    { n: 3, text: `Preencha **Função** com seu cargo — por exemplo, **${ROLE_VALUE}**.` },
    { n: 4, text: 'Cada campo salva sozinho: um ✓ aparece ao lado assim que a alteração é gravada.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'minha-conta',
  slug: 'editar-perfil',
  title: 'Como editar seu perfil',
  description: 'Atualize seus dados — telefone, empresa, cargo e localização.',
  tip: 'Você controla quem vê cada informação pelo ícone de visibilidade ao lado do campo.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/settings/user`,
  setup,
  record,
};
