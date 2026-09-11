import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CONTACT_NAME = 'João Pereira';
const CONTACT_EMAIL = 'joao.pereira@exemplo.com';
const UPDATED_PHONE = '(11) 97777-6666';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/contacts`);

  const newContactButton = page.getByRole('button', { name: 'Novo contato', exact: true });
  await newContactButton.waitFor({ state: 'visible', timeout: 20000 });
  await newContactButton.click();

  const nameField = page.getByRole('textbox', { name: 'Nome', exact: true });
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(CONTACT_NAME);

  const emailField = page.getByLabel('email', { exact: true });
  await emailField.fill(CONTACT_EMAIL);

  const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
  await saveButton.click();

  const contactListEntry = page.getByText(CONTACT_NAME).first();
  await contactListEntry.waitFor({ state: 'visible', timeout: 20000 });

  return context;
}

// Contacts renders one form for both the "new contact" and "edit contact"
// states — an existing contact's phone row is already present (empty) once
// "Editar" is clicked, so no "Adicionar propriedade deste tipo" control is
// needed to reveal the telefone field.
async function record(page: Page): Promise<readonly Step[]> {
  const contactListEntry = page.getByText(CONTACT_NAME).first();
  await contactListEntry.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, contactListEntry, 600);

  const editButton = page.getByRole('button', { name: 'Editar', exact: true });
  await editButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, editButton, 500);

  const phoneField = page.getByLabel('tel', { exact: true });
  await phoneField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, phoneField, 300);
  await phoneField.fill(UPDATED_PHONE);
  await pause(700);

  const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
  await pause(300);
  await moveAndClick(page, saveButton, 500);

  const updatedPhone = page.getByText(UPDATED_PHONE).first();
  await updatedPhone.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  return [
    { n: 1, text: `Na lista de **Contatos**, clique em **${CONTACT_NAME}** para abrir o contato.` },
    { n: 2, text: 'Clique em **Editar** para alterar as informações do contato.' },
    { n: 3, text: `Atualize o **telefone** (ex.: **${UPDATED_PHONE}**) — ou o e-mail, cargo ou empresa.` },
    { n: 4, text: 'Clique em **Salvar** para guardar a alteração.' },
    { n: 5, text: 'O novo telefone aparece no contato assim que a página atualiza.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'contatos',
  slug: 'editar-contato',
  title: 'Como editar um contato',
  description: 'Atualize o telefone, e-mail ou outras informações de um contato.',
  tip: 'Clique em Salvar após editar — as mudanças não são salvas sozinhas.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/contacts`,
  setup,
  record,
};
