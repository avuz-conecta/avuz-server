import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const FORM_TITLE = 'Pesquisa de satisfação';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const newFormButton = page.getByRole('button', { name: 'Novo formulário', exact: true });
  await newFormButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newFormButton, 500);

  const titleField = page.getByPlaceholder('Título do Formulário');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await titleField.fill(FORM_TITLE);
  await pause(600);

  const descriptionField = page.getByPlaceholder('Descrição (há suporte para formatação usando Markdown)');
  await moveAndClick(page, descriptionField, 500);
  await pause(1000);

  const formListEntry = page.getByText(FORM_TITLE).first();
  await formListEntry.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1000);

  return [
    { n: 1, text: 'Abra os **Formulários** e clique em **Novo formulário**.' },
    { n: 2, text: `Digite um título para o formulário (ex.: **${FORM_TITLE}**).` },
    { n: 3, text: 'Clique no campo **Descrição** para confirmar o título.' },
    { n: 4, text: 'O formulário é salvo automaticamente e o editor fica pronto para adicionar perguntas.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'formularios',
  slug: 'criar-formulario',
  title: 'Como criar um formulário',
  description: 'Crie formulários e pesquisas para coletar respostas.',
  tip: 'Comece pelo título — depois adicione as perguntas.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/apps/forms`,
  setup,
  record,
};
