import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CONTACT_NAMES = ['Ana Beatriz', 'Bruno Costa', 'Carla Dias'] as const;
const SEARCH_TERM = 'Bruno';
const MATCHED_CONTACT = 'Bruno Costa';

async function contactExists(page: Page, name: string): Promise<boolean> {
  return page
    .getByText(name, { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
}

// A "Novo contato" save silently never enables when the typed name already
// matches an existing contact (the form doesn't error, it just never offers
// Salvar), so setup skips names that are already in the address book instead
// of recreating them on every run.
async function createContact(page: Page, name: string): Promise<void> {
  const newContactButton = page.getByRole('button', { name: 'Novo contato', exact: true });
  await newContactButton.waitFor({ state: 'visible', timeout: 20000 });
  await newContactButton.click();

  const nameField = page.getByRole('textbox', { name: 'Nome', exact: true });
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(name);

  const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
  await saveButton.click({ timeout: 20000 });

  const contactListEntry = page.getByText(name).first();
  await contactListEntry.waitFor({ state: 'visible', timeout: 20000 });
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/contacts`);

  const newContactButton = page.getByRole('button', { name: 'Novo contato', exact: true });
  await newContactButton.waitFor({ state: 'visible', timeout: 20000 });

  for (const name of CONTACT_NAMES) {
    if (await contactExists(page, name)) continue;
    await createContact(page, name);
  }

  return context;
}

// The Contacts list re-renders as the search box filters it, which detaches
// any locator captured before filtering. The search input itself (unlike the
// list rows) is not re-mounted, so it's targeted by its stable id rather than
// its accessible name — that label text flips to "Pesquisando…" while
// filtering, which would break a getByPlaceholder/getByRole match mid-search.
// Every other locator here is re-queried fresh right before use (no stored
// handles), and a short pause follows the filter so the re-render settles
// before the next action.
async function record(page: Page): Promise<readonly Step[]> {
  const searchToggleButton = page.getByRole('button', { name: 'Pesquisar contatos', exact: true });
  await searchToggleButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, searchToggleButton, 500);

  const searchField = page.locator('#contactsmenu__menu__search');
  await searchField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(300);
  await searchField.fill(SEARCH_TERM);
  await pause(900);

  const matchedContact = page.getByText(MATCHED_CONTACT, { exact: true }).first();
  await matchedContact.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra os **Contatos** e clique no campo **Pesquisar contatos**.' },
    { n: 2, text: `Digite o nome, e-mail ou telefone que você procura (ex.: **${SEARCH_TERM}**).` },
    { n: 3, text: 'A lista filtra em tempo real e mostra só os contatos que combinam com a busca.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'contatos',
  slug: 'buscar-contato',
  title: 'Como buscar um contato',
  description: 'Encontre um contato rapidamente pelo nome, e-mail ou telefone.',
  tip: 'A busca filtra a lista conforme você digita.',
  order: 4,
  startUrl: `${CONFIG.stagingUrl}/apps/contacts`,
  setup,
  record,
};
