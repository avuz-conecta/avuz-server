import type { Browser, Locator, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const DOCUMENT_NAME = 'Ata da reunião';
const EDITOR_READY_TIMEOUT_MS = 30000;

function getEditorFrame(page: Page) {
  return page.frameLocator('#onlyofficeFrame').frameLocator('iframe[name="frameEditor"]');
}

async function typeIntoDocument(page: Page): Promise<void> {
  const editorFrame = getEditorFrame(page);
  await editorFrame.locator('body').click({ position: { x: 400, y: 320 }, timeout: 5000 });
  await page.keyboard.type('Pauta da reunião: alinhamento semanal da equipe.', { delay: 25 });
}

async function submitNewDocumentDialog(page: Page, dialog: Locator): Promise<void> {
  const createButton = dialog.getByRole('button', { name: 'Criar' });
  // The dialog occasionally swallows the first click with no visible effect
  // and no request fired (a debounced name-check race). Retry a few times,
  // giving up only once the dialog itself is gone (submit succeeded).
  for (let attempt = 0; attempt < 4; attempt++) {
    await createButton.click();
    await page.waitForTimeout(3000);
    const stillOpen = await dialog.isVisible().catch(() => false);
    if (!stillOpen) return;
  }
  throw new Error('BLOCKED: the "Novo documento" dialog would not submit after repeated attempts.');
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  await newButton.click();

  const menu = page.getByRole('menu');
  const newDocumentMenuItem = menu.getByRole('menuitem', { name: 'Novo documento', exact: true });
  await newDocumentMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await newDocumentMenuItem.click();
  const dialog = page.getByRole('dialog');
  const nameField = dialog.getByRole('textbox');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(`${DOCUMENT_NAME}.docx`);
  // The dialog debounces an async name-availability check on blur; clicking
  // Criar before that settles is a silent no-op (no request fires at all).
  // Blur the field and give it a beat before submitting.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);
  await shoot(page, framesDir, frame++);

  await submitNewDocumentDialog(page, dialog);

  // The submit above navigates the page into the OnlyOffice editor view.
  // Capture the "opening" state before we know whether the editor will
  // finish loading, then gate on a real readiness signal with a hard cap
  // so a dead office server fails fast instead of hanging the capture.
  const editorFrameRoot = page.locator('#onlyofficeFrame');
  await editorFrameRoot.waitFor({ state: 'attached', timeout: 20000 });
  // The iframe attaches before it paints anything; give it a moment so this
  // frame shows the loading skeleton instead of a blank white page.
  await page.waitForTimeout(1000);
  await shoot(page, framesDir, frame++);

  const editorFrame = getEditorFrame(page);
  try {
    await editorFrame.getByText('Página Inicial', { exact: true }).waitFor({
      state: 'visible',
      timeout: EDITOR_READY_TIMEOUT_MS,
    });
  } catch {
    await shoot(page, framesDir, frame++);
    throw new Error('BLOCKED: OnlyOffice editor did not become ready within 30s (office server may be down).');
  }

  // The toolbar renders before the "loading document" overlay clears, and
  // the office server's own document-conversion step is sometimes slow.
  // Poll the overlay's actual visibility (Playwright's waitFor({state:
  // 'hidden'}) can resolve on a false transition here) for a bounded extra
  // stretch. If it's still up when the budget runs out, the canvas
  // click/type below just no-ops (caught below) and we still capture the
  // open editor with its toolbar, which is enough to show "editing a
  // document".
  const loadingOverlay = editorFrame.getByText('Carregando documento').first();
  for (let attempt = 0; attempt < 12; attempt++) {
    const stillLoading = await loadingOverlay.isVisible().catch(() => false);
    if (!stillLoading) break;
    await page.waitForTimeout(1000);
  }

  try {
    await typeIntoDocument(page);
  } catch {
    // Best-effort: the OnlyOffice canvas can be finicky to type into across
    // versions. Capturing the open editor with its toolbar still shows
    // "editing a document", which is the point of this flow.
  }

  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: 'Abra o **Drive**, clique em **Novo** e depois em **Novo documento**.' },
    {
      n: 2,
      text: `Digite um nome para o arquivo (ex.: **${DOCUMENT_NAME}**) e clique em **Criar**.`,
    },
    {
      n: 3,
      text: 'O editor OnlyOffice abre automaticamente na mesma tela, carregando o documento.',
    },
    {
      n: 4,
      text: 'Digite o conteúdo direto no editor — as alterações são salvas automaticamente no Drive.',
    },
  ];

  return {
    title: 'Como editar um documento',
    description: 'Crie e edite documentos de texto, planilhas e apresentações direto no navegador.',
    app: 'drive',
    slug: 'editar-documento',
    order: 5,
    media: 'editar-documento.mp4',
    tip: 'As alterações são salvas automaticamente enquanto você edita — não é preciso clicar em Salvar.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
