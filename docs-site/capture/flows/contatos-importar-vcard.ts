import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const IMPORTED_CONTACTS = ['Fernanda Lima', 'Ricardo Alves'] as const;

const VCARD_CONTENT = `BEGIN:VCARD
VERSION:3.0
FN:Fernanda Lima
N:Lima;Fernanda;;;
EMAIL:fernanda.lima@exemplo.com
TEL;TYPE=CELL:(11) 96666-5555
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Ricardo Alves
N:Alves;Ricardo;;;
EMAIL:ricardo.alves@exemplo.com
TEL;TYPE=CELL:(11) 95555-4444
END:VCARD
`;

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

// The Contacts settings dialog and the "Importar contatos" dialog it opens
// are nested NcModal instances, both present in the DOM at once — the import
// dialog is simply the topmost one. Selecting a file happens by feeding the
// hidden #contact-import input directly (setInputFiles works on a hidden
// input without needing the OS file picker); clicking "Selecionar um arquivo
// local" instead would open a real native dialog and hang the run. Import
// starts the moment the input's change event fires — there's no address-book
// picker or separate confirm step, it always lands in the personal "Contatos"
// address book. Both dialogs are closed with Escape afterward rather than a
// "Fechar" button locator, since that label is ambiguous (it names both the
// modal's close icon and the post-import close button).
async function record(page: Page): Promise<readonly Step[]> {
  const vcardDir = await mkdtemp(join(tmpdir(), 'avuz-capture-vcard-'));
  try {
    const vcardPath = join(vcardDir, 'contatos-antigo-sistema.vcf');
    await writeFile(vcardPath, VCARD_CONTENT, 'utf8');

    const settingsButton = page.getByRole('button', { name: 'Abrir as configurações do aplicativo Contatos', exact: true });
    await settingsButton.waitFor({ state: 'visible', timeout: 20000 });
    await pause(600);
    await moveAndClick(page, settingsButton, 500);

    const importContactsButton = page.getByRole('button', { name: 'Importar contatos', exact: true });
    await importContactsButton.waitFor({ state: 'visible', timeout: 10000 });
    await pause(600);
    await moveAndClick(page, importContactsButton, 500);

    const importDialog = page.getByRole('dialog').last();
    const localFileButton = importDialog.getByRole('button', { name: 'Selecionar um arquivo local', exact: true });
    await localFileButton.waitFor({ state: 'visible', timeout: 10000 });
    await pause(700);

    await page.locator('#contact-import').setInputFiles(vcardPath);

    const importedMessage = importDialog.getByText(/Importação concluída/);
    await importedMessage.waitFor({ state: 'visible', timeout: 20000 });
    await pause(1400);

    await page.keyboard.press('Escape');
    await pause(400);
    await page.keyboard.press('Escape');
    await pause(600);

    // The contact list is virtualized (off-screen rows aren't in the DOM),
    // so confirming an imported contact "shows up" is done the same way
    // contatos-buscar-contato.ts does it: through the header's contacts-menu
    // quick search (id contactsmenu__menu__search) rather than scrolling the
    // list itself.
    const searchToggleButton = page.getByRole('button', { name: 'Pesquisar contatos', exact: true });
    await searchToggleButton.waitFor({ state: 'visible', timeout: 20000 });
    await pause(500);
    await moveAndClick(page, searchToggleButton, 500);

    const searchField = page.locator('#contactsmenu__menu__search');
    await searchField.waitFor({ state: 'visible', timeout: 10000 });
    await pause(300);
    await searchField.fill(IMPORTED_CONTACTS[0]);
    await pause(900);

    const matchedContact = page.getByText(IMPORTED_CONTACTS[0], { exact: true }).first();
    await matchedContact.waitFor({ state: 'visible', timeout: 10000 });
    await pause(1200);

    return [
      { n: 1, text: 'Abra os **Contatos** e clique em **Configurações de Contatos**, no rodapé do menu lateral.' },
      { n: 2, text: 'Clique em **Importar contatos**.' },
      { n: 3, text: 'Escolha o arquivo **.vcf** exportado do seu sistema anterior.' },
      { n: 4, text: 'A importação acontece na hora — os contatos já entram na sua agenda.' },
      {
        n: 5,
        text: `Pesquise um dos nomes importados (ex.: **${IMPORTED_CONTACTS[0]}**) para confirmar que ele já está na sua lista.`,
      },
    ];
  } finally {
    await rm(vcardDir, { recursive: true, force: true });
  }
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'contatos',
  slug: 'importar-vcard',
  title: 'Como importar contatos',
  description: 'Traga contatos de outro sistema importando um arquivo vCard (.vcf).',
  tip: 'Exporte seus contatos do sistema antigo como .vcf e importe aqui de uma vez.',
  order: 5,
  startUrl: `${CONFIG.stagingUrl}/apps/contacts`,
  setup,
  record,
};
