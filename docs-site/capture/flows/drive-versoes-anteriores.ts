import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import { webdavUrl } from '../seed/seed';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

function buildDifferentPdf(): Buffer {
  const header = '%PDF-1.4\n%AVUZ-VERSION-CAPTURE\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ];
  let body = header;
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

function basicAuthHeader(uid: string, password: string): string {
  return `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
}

async function createNewVersion(): Promise<void> {
  const response = await fetch(webdavUrl(CONFIG.stagingUrl, 'demo.ana', FILE_NAME), {
    method: 'PUT',
    headers: {
      Authorization: basicAuthHeader('demo.ana', CONFIG.demoUserPassword),
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(buildDifferentPdf()),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to PUT new version of ${FILE_NAME}: ${response.status}`);
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  await createNewVersion();

  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });

  await fileRow.getByRole('button', { name: 'Ações' }).click();
  const fileMenu = page.getByRole('menu');
  const detalhesItem = fileMenu.getByRole('menuitem', { name: 'Detalhes', exact: true });
  await detalhesItem.waitFor({ state: 'visible', timeout: 10000 });
  await detalhesItem.click();

  const sidebar = page.getByRole('complementary');
  await sidebar.waitFor({ state: 'visible', timeout: 10000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  const versoesTab = sidebar.getByRole('tab', { name: 'Versões' });
  await versoesTab.click();
  const versoesPanel = sidebar.getByRole('tabpanel', { name: 'Versões' });
  await versoesPanel.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const versionList = versoesPanel.getByRole('list', { name: 'Versões do arquivo' });
  const previousVersion = versionList.getByRole('listitem').filter({ hasText: 'Versão inicial' });
  await previousVersion.waitFor({ state: 'visible', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const versionActionsButton = previousVersion.getByRole('button', { name: /Ações para versão/ });
  await versionActionsButton.click();
  const versionMenu = page.getByRole('menu').last();
  await versionMenu.getByRole('menuitem', { name: 'Restaurar versão' }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Ações** na linha do arquivo e selecione **Detalhes** para abrir o painel lateral.',
    },
    {
      n: 3,
      text: 'No painel, clique na aba **Versões** para ver o histórico de alterações do arquivo.',
    },
    {
      n: 4,
      text: 'Cada versão anterior aparece na lista, com data e tamanho. Clique em **Ações** ao lado de uma versão para **Restaurar versão**, baixá-la ou renomeá-la.',
    },
  ];

  return {
    title: 'Como ver versões anteriores',
    description: 'Veja o histórico de alterações de um arquivo e volte a uma versão anterior.',
    app: 'drive',
    slug: 'versoes-anteriores',
    order: 8,
    media: 'versoes-anteriores.mp4',
    tip: 'Cada vez que o arquivo muda, o Drive guarda a versão antiga — dá para restaurá-la a qualquer momento pela aba Versões.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
