import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'proposta-comercial.pdf';

function buildMinimalPdf(): Buffer {
  const header = '%PDF-1.4\n';
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

async function createTempPdf(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'avuz-capture-upload-'));
  const filePath = join(dir, FILE_NAME);
  await writeFile(filePath, new Uint8Array(buildMinimalPdf()));
  return filePath;
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await page.goto(`${CONFIG.stagingUrl}/apps/files`);

  const newButton = page.getByRole('button', { name: 'Novo', exact: true });
  await newButton.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await newButton.click();
  const menu = page.getByRole('menu');
  const uploadMenuItem = menu.getByRole('menuitem', { name: 'Fazer upload de arquivos' });
  await uploadMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const tempFilePath = await createTempPdf();
  try {
    const fileInput = page.locator('form[data-cy-upload-picker] input[type="file"]');
    await fileInput.setInputFiles(tempFilePath);

    await page.mouse.click(640, 600);

    const uploadedRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
    await uploadedRow.waitFor({ state: 'visible', timeout: 20000 });
    await shoot(page, framesDir, frame++);
  } finally {
    await rm(dirname(tempFilePath), { recursive: true, force: true });
  }

  const steps: readonly Step[] = [
    { n: 1, text: 'Abra o **Drive** e clique em **Novo** na barra superior da lista de arquivos.' },
    {
      n: 2,
      text: 'Selecione **Fazer upload de arquivos** e escolha o arquivo no seu computador.',
    },
    {
      n: 3,
      text: `O envio começa na hora: assim que termina, o arquivo (ex.: **${FILE_NAME}**) aparece na lista.`,
    },
  ];

  return {
    title: 'Como enviar arquivos',
    description: 'Envie documentos e fotos do seu computador para o Drive.',
    app: 'drive',
    slug: 'enviar-arquivos',
    order: 1,
    media: 'enviar-arquivos.mp4',
    tip: 'Também dá para arrastar e soltar os arquivos direto na lista do Drive.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
