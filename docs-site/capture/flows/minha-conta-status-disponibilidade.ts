import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const userMenuTrigger = page.getByRole('button', { name: 'Menu de configurações', exact: true });
  await userMenuTrigger.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);
  await moveAndClick(page, userMenuTrigger, 500);

  const userMenu = page.locator('#header-menu-user-menu');
  const statusMenuItem = userMenu.locator('a:has(.user-status-icon)');
  await statusMenuItem.waitFor({ state: 'visible', timeout: 10000 });
  await pause(400);
  await moveAndClick(page, statusMenuItem, 500);

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Status on-line', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await pause(600);

  const awayOption = page.locator('label[for="user-status-online-status-away"]');
  await awayOption.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, awayOption, 700);

  const meetingOption = page.locator('label[for="user-status-predefined-status-meeting"]');
  await meetingOption.waitFor({ state: 'visible', timeout: 10000 });
  await pause(500);
  await moveAndClick(page, meetingOption, 700);

  const confirmButton = dialog.getByRole('button', { name: 'Definir mensagem de status', exact: true });
  await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
  await pause(600);
  await moveAndClick(page, confirmButton, 600);
  await confirmButton.waitFor({ state: 'hidden', timeout: 10000 });
  await pause(500);

  await moveAndClick(page, userMenuTrigger, 600);
  const appliedStatus = statusMenuItem.filter({ hasText: 'Em reunião' });
  await appliedStatus.waitFor({ state: 'visible', timeout: 10000 });
  await pause(1200);

  return [
    { n: 1, text: 'No menu do seu perfil (avatar, canto superior direito), clique em **Definir status**.' },
    { n: 2, text: 'Selecione **Fora** para indicar que você está fora do computador.' },
    { n: 3, text: 'Escolha uma mensagem, como **Em reunião**, e clique em **Definir mensagem de status**.' },
    { n: 4, text: 'Seu novo status aparece imediatamente no menu do perfil.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'minha-conta',
  slug: 'status-disponibilidade',
  title: 'Como definir seu status de disponibilidade',
  description: 'Avise os colegas se você está disponível, ausente ou ocupado.',
  tip: 'Um status "Não perturbe" silencia as notificações de chamada.',
  order: 2,
  startUrl: `${CONFIG.stagingUrl}/apps/dashboard`,
  setup,
  record,
};
