import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CONTACT_NAME = 'Maria Oliveira';
const CONTACT_PHONE = '(11) 98888-7777';
const CONTACT_EMAIL = 'maria@exemplo.com';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const newContactButton = page.getByRole('button', { name: 'Novo contato', exact: true });
  await newContactButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newContactButton, 500);

  const nameField = page.getByRole('textbox', { name: 'Nome', exact: true });
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, nameField, 300);
  await nameField.fill(CONTACT_NAME);
  await pause(600);

  const phoneField = page.getByLabel('tel', { exact: true });
  await moveAndClick(page, phoneField, 400);
  await phoneField.fill(CONTACT_PHONE);
  await pause(500);

  const emailField = page.getByLabel('email', { exact: true });
  await moveAndClick(page, emailField, 400);
  await emailField.fill(CONTACT_EMAIL);
  await pause(600);

  const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
  await pause(300);
  await moveAndClick(page, saveButton, 500);

  const contactListEntry = page.getByText(CONTACT_NAME).first();
  await contactListEntry.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra os **Contatos** e clique em **Novo contato**.' },
    { n: 2, text: `Digite o nome no campo **Nome** (ex.: **${CONTACT_NAME}**).` },
    { n: 3, text: 'Preencha o **telefone** e o **e-mail** do contato.' },
    { n: 4, text: 'Clique em **Salvar** para guardar o contato na sua agenda.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'contatos',
  slug: 'criar-contato',
  title: 'Como criar um contato',
  description: 'Guarde nomes, e-mails e telefones na sua agenda de contatos.',
  tip: 'Depois de preencher os dados, clique em **Salvar** — os contatos não salvam sozinhos.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/contacts`,
  setup,
  record,
};
