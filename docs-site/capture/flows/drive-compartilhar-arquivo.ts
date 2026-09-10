import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import type { Step, TaskDoc } from '../lib/steps';

const FILE_NAME = 'relatorio.pdf';

async function maskRealHost(page: Page): Promise<void> {
  const realHost = new URL(CONFIG.stagingUrl).host;
  const demoDomain = CONFIG.demoDomain;
  await page.evaluate(
    (args: { readonly realHost: string; readonly demoDomain: string }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.nodeValue && textNode.nodeValue.indexOf(args.realHost) !== -1) {
          textNode.nodeValue = textNode.nodeValue.split(args.realHost).join(args.demoDomain);
        }
        textNode = walker.nextNode();
      }

      const attrElements = Array.from(document.querySelectorAll('[title], [aria-label]'));
      for (let i = 0; i < attrElements.length; i++) {
        const el = attrElements[i];
        const title = el.getAttribute('title');
        if (title && title.indexOf(args.realHost) !== -1) {
          el.setAttribute('title', title.split(args.realHost).join(args.demoDomain));
        }
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.indexOf(args.realHost) !== -1) {
          el.setAttribute('aria-label', ariaLabel.split(args.realHost).join(args.demoDomain));
        }
      }

      const fields = Array.from(document.querySelectorAll('input, textarea'));
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i] as HTMLInputElement | HTMLTextAreaElement;
        if (field.value && field.value.indexOf(args.realHost) !== -1) {
          field.value = field.value.split(args.realHost).join(args.demoDomain);
        }
      }
    },
    { realHost, demoDomain },
  );
}

async function shoot(page: Page, framesDir: string, index: number): Promise<void> {
  await maskRealHost(page);
  const fileName = `frame-${String(index).padStart(4, '0')}.png`;
  await page.screenshot({ path: join(framesDir, fileName) });
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  const { context, page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(`${CONFIG.stagingUrl}/apps/files`);
  const fileRow = page.getByRole('row', { name: new RegExp(FILE_NAME.replace('.', '\\.')) });
  await fileRow.waitFor({ state: 'visible', timeout: 20000 });
  let frame = 0;
  await shoot(page, framesDir, frame++);

  await fileRow.getByRole('button', { name: 'Opções de compartilhamento' }).click();
  const sidebar = page.getByRole('complementary');
  await sidebar.getByText('Criar link público').waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await sidebar.getByRole('button', { name: 'Criar um novo link de compartilhamento' }).click();
  await sidebar.getByText('Link de compartilhamento').waitFor({ state: 'visible', timeout: 10000 });
  await page.getByText('Link copiado').waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  // The toasts above auto-dismiss after a few seconds; wait them out so the
  // final frame shows the settled share entry instead of stacked toasts.
  await page.getByText('Link copiado').waitFor({ state: 'hidden', timeout: 15000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    { n: 1, text: `Abra o **Drive** e localize **${FILE_NAME}** na lista de arquivos.` },
    {
      n: 2,
      text: 'Clique em **Opções de compartilhamento** na linha do arquivo para abrir o painel **Compartilhando**.',
    },
    {
      n: 3,
      text: 'Em **Compartilhamentos externos**, clique em **Criar link público**: o Drive gera o link e já copia o endereço, confirmando com **Link copiado**.',
    },
    {
      n: 4,
      text: 'O link fica disponível em **Link de compartilhamento**, pronto para colar onde quiser; ajuste **Somente visualização** ou **Permitir edição** se precisar.',
    },
  ];

  return {
    title: 'Como compartilhar um arquivo',
    description: 'Gere um link para enviar um arquivo a qualquer pessoa.',
    app: 'drive',
    slug: 'compartilhar-arquivo',
    order: 1,
    media: 'compartilhar-arquivo.mp4',
    tip: 'Precisa de mais controle? Defina senha e validade no mesmo painel de compartilhamento.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  run,
};
