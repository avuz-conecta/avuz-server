import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { resetTenant } from './seed/seed';
import { launch } from './lib/browser';
import { recordFlow, encodeWebm } from './lib/screencast';
import { writeTaskPage } from './lib/page-writer';
import type { Step, TaskDoc } from './lib/steps';

export type Flow = {
  readonly capturedForVersion: string;
  readonly app: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly tip?: string;
  readonly order: number;
  readonly startUrl: string; // page navigates here (already authed) to begin recording
  readonly fakeMedia?: boolean; // launch chromium with synthetic camera/mic + grant permissions on the recorded context
  readonly fakeVideo?: string; // y4m file fed to --use-file-for-fake-video-capture when fakeMedia is set
  setup(browser: Browser): Promise<BrowserContext>; // unrecorded login + precondition
  record(page: Page): Promise<readonly Step[]>; // the demonstrated action; returns annotated steps
};

async function makeTempRecordingDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'avuz-capture-video-'));
}

function toTaskDoc(flow: Flow, steps: readonly Step[]): TaskDoc {
  return {
    title: flow.title,
    description: flow.description,
    app: flow.app,
    slug: flow.slug,
    order: flow.order,
    media: `${flow.slug}.mp4`,
    tip: flow.tip,
    steps,
  };
}

async function main(): Promise<void> {
  const flowArg = process.argv[2];
  if (!flowArg) throw new Error('usage: tsx capture/run.ts <flow-file>');
  const mod: { readonly flow: Flow } = await import(new URL(flowArg, `file://${process.cwd()}/capture/`).href);
  const flow = mod.flow;

  await resetTenant();
  const browser = await launch({ fakeMedia: flow.fakeMedia, fakeVideo: flow.fakeVideo });
  try {
    const outDir = await makeTempRecordingDir();
    const { webmPath, steps } = await recordFlow(browser, {
      setup: flow.setup,
      startUrl: flow.startUrl,
      record: flow.record,
      outDir,
      fakeMedia: flow.fakeMedia,
    });

    const outMp4 = `public/assets/${flow.app}/${flow.slug}.mp4`;
    await encodeWebm(webmPath, outMp4);

    const doc = toTaskDoc(flow, steps);
    const path = await writeTaskPage(doc, flow.capturedForVersion, 'src/content/docs');
    console.log(`✓ ${flow.app}/${flow.slug} → ${path}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
