import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import { resetTenant } from './seed/seed';
import { launch } from './lib/browser';
import { encodeFrames } from './lib/encode';
import { writeTaskPage } from './lib/page-writer';
import type { TaskDoc } from './lib/steps';

export type Flow = {
  readonly capturedForVersion: string;
  readonly fakeMedia?: boolean;
  readonly fakeVideo?: string;
  run(browser: Browser, framesDir: string): Promise<TaskDoc>;
};

async function makeTempFramesDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'avuz-capture-frames-'));
}

async function main(): Promise<void> {
  const flowArg = process.argv[2];
  if (!flowArg) throw new Error('usage: tsx capture/run.ts <flow-file>');
  const mod: { readonly flow: Flow } = await import(new URL(flowArg, `file://${process.cwd()}/capture/`).href);
  const flow = mod.flow;

  await resetTenant();
  const browser = await launch({ fakeMedia: flow.fakeMedia, fakeVideo: flow.fakeVideo });
  const framesDir = await makeTempFramesDir();
  try {
    const doc = await flow.run(browser, framesDir);
    await encodeFrames(framesDir, `src/assets/${doc.app}/${doc.media}`);
    const path = await writeTaskPage(doc, flow.capturedForVersion, 'src/content/docs');
    console.log(`✓ ${doc.app}/${doc.slug} → ${path}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
