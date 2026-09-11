import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { maskRealHost } from '../lib/capture-helpers';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const EVENT_TITLE = 'Reunião com cliente';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

// Creating the Talk conversation is an async round trip: the link (and its
// real staging host) lands in the DOM ~500-600ms after the click, with no
// warning. A plain wait-then-mask leaves the real host on screen for one or
// more recorded frames. Polling on requestAnimationFrame and masking inside
// the very same predicate call masks the link before the browser's next
// paint — no separate round trip, so no frame is ever painted unmasked.
async function waitForTalkLinkAndMask(page: Page): Promise<void> {
  const realHost = new URL(CONFIG.stagingUrl).host;
  const demoDomain = CONFIG.demoDomain;
  await page.waitForFunction(
    (args: { readonly realHost: string; readonly demoDomain: string }) => {
      const link = document.querySelector('a[href*="/call/"]');
      if (!link) return false;

      const href = link.getAttribute('href');
      if (href && href.indexOf(args.realHost) !== -1) {
        link.setAttribute('href', href.split(args.realHost).join(args.demoDomain));
      }

      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.nodeValue && textNode.nodeValue.indexOf(args.realHost) !== -1) {
          textNode.nodeValue = textNode.nodeValue.split(args.realHost).join(args.demoDomain);
        }
        textNode = walker.nextNode();
      }

      return true;
    },
    { realHost, demoDomain },
    { timeout: 10000, polling: 'raf' },
  );
}

async function record(page: Page): Promise<readonly Step[]> {
  const newEventButton = page.getByRole('button', { name: 'Criar novo evento' });
  await newEventButton.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, newEventButton, 500);

  const titleField = page.getByPlaceholder('Título do evento');
  await titleField.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await titleField.fill(EVENT_TITLE);
  await pause(800);

  const moreDetailsButton = page.getByRole('button', { name: 'Mais detalhes' });
  await moveAndClick(page, moreDetailsButton, 500);

  // The compact popover has no Talk control — it only appears in the full
  // editor opened by "Mais detalhes". The exact-text match avoids colliding
  // with the unrelated "Adicionar" (participants) button in the same modal.
  const addTalkButton = page.getByRole('button', { name: 'Adicionar conversa do Talk', exact: true });
  await addTalkButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, addTalkButton, 600);

  // Clicking "Adicionar conversa do Talk" opens a "Selecione uma Sala do
  // Talk" picker (no existing rooms yet in a fresh event) with two "create"
  // options. Creating a private conversation attaches its link directly to
  // the event's location field and closes the picker.
  const createPrivateConversation = page.getByRole('button', { name: 'Criar conversa privada' });
  await createPrivateConversation.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, createPrivateConversation, 600);

  await waitForTalkLinkAndMask(page);
  await maskRealHost(page); // full-page pass, e.g. the "Adicionado com sucesso" toast
  await pause(800);

  const saveButton = page.getByRole('button', { name: 'Salvar' });
  await moveAndClick(page, saveButton, 500);

  const eventChip = page.getByText(EVENT_TITLE).first();
  await eventChip.waitFor({ state: 'visible', timeout: 20000 });
  await pause(1200);

  return [
    { n: 1, text: 'Abra a **Agenda** e clique em **Criar novo evento**.' },
    { n: 2, text: `Digite um título para o evento (ex.: **${EVENT_TITLE}**).` },
    { n: 3, text: 'Clique em **Mais detalhes** para abrir as opções completas do evento.' },
    { n: 4, text: 'Clique em **Adicionar conversa do Talk** para anexar uma sala de vídeo ao evento.' },
    { n: 5, text: 'Escolha **Criar conversa privada** para gerar uma nova sala do Talk para essa reunião.' },
    { n: 6, text: 'O link da reunião do Talk aparece no evento. Clique em **Salvar** para confirmar.' },
    { n: 7, text: 'Todos os convidados encontram o link da reunião direto no evento, na hora de entrar.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'agenda',
  slug: 'anexar-reuniao-talk',
  title: 'Como anexar uma reunião do Talk a um evento',
  description: 'Adicione uma sala de vídeo do Talk ao evento — todos entram pelo mesmo link na hora.',
  tip: 'Os convidados encontram o link da reunião direto no evento da Agenda.',
  order: 9,
  startUrl: `${CONFIG.stagingUrl}/apps/calendar`,
  setup,
  record,
};
