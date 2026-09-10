import type { Browser, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { shoot } from '../lib/capture-helpers';
import type { Step, TaskDoc } from '../lib/steps';

const CONVERSATION_NAME = 'Chamada de Teste';

async function dismissBrowserWarning(page: Page): Promise<void> {
  const closeIcon = page.locator('.toastify').getByText('✖').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ timeout: 3000 }).catch(() => undefined);
  }
}

async function createConversation(page: Page): Promise<void> {
  await page.goto(`${CONFIG.stagingUrl}/apps/spreed`);
  await dismissBrowserWarning(page);
  await page.getByRole('button', { name: 'Criar uma nova conversa' }).click();

  const createDialog = page.getByRole('dialog');
  const nameField = createDialog.getByPlaceholder('Digite um nome para esta conversa');
  await nameField.waitFor({ state: 'visible', timeout: 15000 });
  await nameField.fill(CONVERSATION_NAME);

  await createDialog.getByRole('button', { name: 'Adicionar participantes' }).click();
  await createDialog.getByRole('button', { name: 'Criando conversa' }).click();
  await page.getByRole('heading', { name: CONVERSATION_NAME }).waitFor({ state: 'visible', timeout: 20000 });
}

async function startCall(page: Page): Promise<void> {
  const label = 'Iniciar chamada';
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

async function toggleMicrophone(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function toggleCamera(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label }).first().click();
}

async function run(browser: Browser, framesDir: string): Promise<TaskDoc> {
  let frame = 0;

  const { page } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  await createConversation(page);
  await startCall(page);
  await page.waitForTimeout(3000);
  await shoot(page, framesDir, frame++);

  await toggleMicrophone(page, 'Desativar microfone');
  await page.getByRole('button', { name: 'Ativar microfone', exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await toggleCamera(page, 'Desativar vídeo');
  await page.getByRole('button', { name: 'Ativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  await toggleCamera(page, 'Ativar vídeo');
  await page.getByRole('button', { name: 'Desativar vídeo' }).waitFor({ state: 'visible', timeout: 10000 });
  await shoot(page, framesDir, frame++);

  const steps: readonly Step[] = [
    {
      n: 1,
      text: `Entre em uma chamada no **Talk**: crie uma conversa como **${CONVERSATION_NAME}** e clique em **Iniciar chamada**.`,
    },
    {
      n: 2,
      text: 'Na barra de controles da chamada, clique em **Desativar microfone** para silenciar o som; o botão passa a mostrar **Ativar microfone**.',
    },
    {
      n: 3,
      text: 'Clique em **Desativar vídeo** para desligar a câmera; sua imagem é substituída por um avatar e o botão passa a mostrar **Ativar vídeo**.',
    },
    {
      n: 4,
      text: 'Clique em **Ativar vídeo** para ligar a câmera de novo a qualquer momento durante a chamada.',
    },
  ];

  return {
    title: 'Como ligar câmera e microfone',
    description: 'Ligue ou desligue seu microfone e sua câmera durante a chamada.',
    app: 'talk',
    slug: 'camera-e-microfone',
    order: 4,
    media: 'camera-e-microfone.mp4',
    tip: 'Silencie o microfone quando não estiver falando para evitar ruído.',
    steps,
  };
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  fakeMedia: true,
  fakeVideo: 'capture/assets/demo-video.y4m',
  run,
};
