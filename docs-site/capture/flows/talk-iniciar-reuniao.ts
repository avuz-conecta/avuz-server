import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import type { Step, TaskDoc } from '../lib/steps';

const MEETING_NAME = 'Reunião Conecta Demo';
const GUEST_DISPLAY_NAME = 'Bruno Lima';

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

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createMeeting(host: Page): Promise<void> {
  await host.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await host.getByRole('button', { name: 'Criar uma nova conversa' }).click();

  const createDialog = host.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(MEETING_NAME);

  await createDialog.getByRole('button', { name: 'Adicionar participantes' }).click();
  const participantSearch = createDialog.getByLabel('Procurar participantes');
  await participantSearch.waitFor({ state: 'visible', timeout: 15000 });
  await participantSearch.fill('demo.bruno');

  const brunoOption = createDialog.getByText(GUEST_DISPLAY_NAME).first();
  await brunoOption.waitFor({ state: 'visible', timeout: 15000 });
  await brunoOption.click();

  await createDialog.getByRole('button', { name: 'Criando conversa' }).click();
  await host.getByRole('heading', { name: MEETING_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

async function startOrJoinCall(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: label }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await trigger.isDisabled())) break;
    await page.waitForTimeout(1000);
  }
  await dismissBrowserWarning(page);
  await trigger.click();

  const dialog = page.getByRole('dialog');
  const confirmButton = dialog.getByRole('button', { name: label });
  await confirmButton.waitFor({ state: 'visible', timeout: 20000 });
  await confirmButton.click();
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  let frame = 0;

  const { page: host } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await createMeeting(host);
  await shoot(host, framesDir, frame++);

  await startOrJoinCall(host, 'Iniciar chamada');
  await shoot(host, framesDir, frame++);

  const { page: guest } = await login(browser, 'demo.bruno', CONFIG.demoUserPassword);
  await guest.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(guest);
  const conversationEntry = guest.getByRole('link', { name: new RegExp(MEETING_NAME) }).first();
  await conversationEntry.waitFor({ state: 'visible', timeout: 20000 });
  await conversationEntry.click();

  await startOrJoinCall(guest, 'Entrar na chamada');

  await host.getByText('entrou na chamada').first().waitFor({ state: 'visible', timeout: 30000 });
  await host.waitForTimeout(3000);
  await shoot(host, framesDir, frame++);

  const steps: readonly Step[] = [
    {
      n: 1,
      text: `Abra o **Talk** e clique em **Criar uma nova conversa**: dê um nome como **${MEETING_NAME}**, adicione os participantes e confirme em **Criando conversa**.`,
    },
    {
      n: 2,
      text: 'Clique em **Iniciar chamada** e confirme em **Iniciar chamada** na tela de verificação de câmera e microfone.',
    },
    {
      n: 3,
      text: 'Quando os convidados clicam em **Entrar na chamada**, eles aparecem lado a lado com você na chamada de vídeo.',
    },
  ];

  return {
    title: 'Como iniciar uma reunião',
    description: 'Crie uma sala no Talk e comece uma chamada de vídeo em segundos.',
    app: 'talk',
    slug: 'iniciar-reuniao',
    order: 1,
    media: 'iniciar-reuniao.mp4',
    tip: 'Compartilhe a tela pelo ícone de monitor durante a chamada.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
