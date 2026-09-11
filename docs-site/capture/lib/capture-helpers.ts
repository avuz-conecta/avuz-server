import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { CONFIG } from '../config';

export async function maskRealHost(page: Page): Promise<void> {
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

export async function shoot(page: Page, framesDir: string, index: number): Promise<void> {
  await maskRealHost(page);
  const fileName = `frame-${String(index).padStart(4, '0')}.png`;
  await page.screenshot({ path: join(framesDir, fileName) });
}
