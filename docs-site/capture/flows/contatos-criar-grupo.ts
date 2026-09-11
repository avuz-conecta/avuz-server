import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const CONTACT_NAME = 'Carla Mendes';
const GROUP_NAME = 'Clientes';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/contacts`);

  const newContactButton = page.getByRole('button', { name: 'Novo contato', exact: true });
  await newContactButton.waitFor({ state: 'visible', timeout: 20000 });
  await newContactButton.click();

  const nameField = page.getByRole('textbox', { name: 'Nome', exact: true });
  await nameField.waitFor({ state: 'visible', timeout: 10000 });
  await nameField.fill(CONTACT_NAME);

  const saveButton = page.getByRole('button', { name: 'Salvar', exact: true });
  await saveButton.click();

  const contactListEntry = page.getByText(CONTACT_NAME).first();
  await contactListEntry.waitFor({ state: 'visible', timeout: 20000 });

  return context;
}

// The "+" beside "Grupos de contatos" opens a teleported popover (not a DOM
// descendant of the sidebar caption), so its input/submit are targeted by
// role globally; only the trigger button itself is scoped to #newgroup.
// Creating the group opens an "Adicionar membros" picker automatically —
// no separate "Salvar" step exists for this flow, membership saves as soon
// as "Adicionar a <grupo>" is clicked.
async function record(page: Page): Promise<readonly Step[]> {
  const createGroupButton = page.locator('#newgroup').getByRole('button', { name: 'Ações', exact: true });
  await createGroupButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, createGroupButton, 500);

  const groupNameField = page.getByPlaceholder('Nome do grupo de contatos');
  await groupNameField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, groupNameField, 300);
  await groupNameField.fill(GROUP_NAME);
  await pause(600);

  const submitGroupButton = page.getByRole('button', { name: 'Enviar', exact: true });
  await pause(300);
  await moveAndClick(page, submitGroupButton, 500);

  const addMembersHeading = page.getByRole('heading', { name: `Adicionar membros a ${GROUP_NAME}` });
  await addMembersHeading.waitFor({ state: 'visible', timeout: 15000 });
  await pause(500);

  const membersDialog = page.locator('.entity-picker');
  const memberSearchField = membersDialog.getByPlaceholder('Pesquisar Contatos…');
  await moveAndClick(page, memberSearchField, 400);
  await memberSearchField.fill(CONTACT_NAME);
  await pause(700);

  const memberResult = membersDialog.getByText(CONTACT_NAME).first();
  await memberResult.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, memberResult, 500);

  const addToGroupButton = membersDialog.getByRole('button', { name: `Adicionar a ${GROUP_NAME}`, exact: true });
  await pause(300);
  await moveAndClick(page, addToGroupButton, 500);

  const addingConfirmation = page.getByText(`Adicionando 1 contato a ${GROUP_NAME}`);
  await addingConfirmation.waitFor({ state: 'visible', timeout: 15000 });
  await pause(700);

  // Two "Fechar" buttons exist here: the modal's icon-only close (X, aria-label
  // only) and this dialog's own text button — getByText matches only the latter.
  const closeConfirmationButton = page.getByText('Fechar', { exact: true });
  await moveAndClick(page, closeConfirmationButton, 500);

  const groupLink = page.getByRole('link', { name: GROUP_NAME, exact: true });
  await groupLink.waitFor({ state: 'visible', timeout: 15000 });
  await pause(500);
  await moveAndClick(page, groupLink, 600);

  const groupedContact = page.getByText(CONTACT_NAME).first();
  await groupedContact.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  return [
    { n: 1, text: `Clique no **+** ao lado de **Grupos de contatos**, na barra lateral de Contatos.` },
    { n: 2, text: `Digite o nome do grupo (ex.: **${GROUP_NAME}**) e clique em **Enviar**.` },
    { n: 3, text: `Na janela **Adicionar membros**, pesquise e selecione o contato (ex.: **${CONTACT_NAME}**).` },
    { n: 4, text: `Clique em **Adicionar a ${GROUP_NAME}** para colocar o contato no grupo.` },
    { n: 5, text: `O grupo **${GROUP_NAME}** aparece na barra lateral com o contato dentro dele.` },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'contatos',
  slug: 'criar-grupo',
  title: 'Como organizar contatos em grupos',
  description: 'Agrupe contatos (ex.: Clientes, Equipe) para encontrá-los e usá-los mais fácil.',
  tip: 'Use grupos para enviar um e-mail ou convite para todos de uma vez.',
  order: 3,
  startUrl: `${CONFIG.stagingUrl}/apps/contacts`,
  setup,
  record,
};
