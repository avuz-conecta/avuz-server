import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CONFIG } from '../config';

export async function launch(opts: { readonly fakeMedia?: boolean; readonly fakeVideo?: string }): Promise<Browser> {
  const args: string[] = [];
  if (opts.fakeMedia) {
    args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
  }
  if (opts.fakeVideo) args.push(`--use-file-for-fake-video-capture=${opts.fakeVideo}`);
  return chromium.launch({ args });
}

export async function login(browser: Browser, uid: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: CONFIG.viewport,
    permissions: ['camera', 'microphone'],
  });
  const page = await context.newPage();
  await page.goto(`${CONFIG.stagingUrl}/login`);
  await page.fill('input[name="user"]', uid);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForURL(/\/apps\/|\/dashboard/, { timeout: 30000 });
  return { context, page };
}
