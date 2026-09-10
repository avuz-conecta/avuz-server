import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { CONFIG } from '../config';
import { maskRealHost } from './capture-helpers';
import type { Step } from './steps';

export const CURSOR_INIT_SCRIPT = `
(function () {
  var DOT_SIZE = 18;
  var dot = document.createElement('div');
  dot.id = '__avuz_cursor__';
  dot.style.position = 'fixed';
  dot.style.left = '0px';
  dot.style.top = '0px';
  dot.style.width = DOT_SIZE + 'px';
  dot.style.height = DOT_SIZE + 'px';
  dot.style.marginLeft = (-DOT_SIZE / 2) + 'px';
  dot.style.marginTop = (-DOT_SIZE / 2) + 'px';
  dot.style.borderRadius = '50%';
  dot.style.background = 'rgba(0, 103, 158, 0.6)';
  dot.style.border = '2px solid white';
  dot.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
  dot.style.pointerEvents = 'none';
  dot.style.zIndex = '2147483647';
  dot.style.transition = 'transform 80ms ease-out';
  dot.style.transform = 'scale(1)';
  dot.style.willChange = 'left, top, transform';

  function attach() {
    if (document.body) document.body.appendChild(dot);
  }
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);

  document.addEventListener(
    'mousemove',
    function (event) {
      dot.style.left = event.clientX + 'px';
      dot.style.top = event.clientY + 'px';
    },
    true,
  );
  document.addEventListener(
    'mousedown',
    function () {
      dot.style.transform = 'scale(0.7)';
    },
    true,
  );
  document.addEventListener(
    'mouseup',
    function () {
      dot.style.transform = 'scale(1)';
    },
    true,
  );
})();
`;

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export type RecordFlowOptions = {
  readonly setup: (browser: Browser) => Promise<BrowserContext>;
  readonly startUrl: string;
  readonly record: (page: Page) => Promise<readonly Step[]>;
  readonly outDir: string;
  readonly fakeMedia?: boolean;
};

export type RecordFlowResult = {
  readonly webmPath: string;
  readonly steps: readonly Step[];
};

async function openRecordedContext(browser: Browser, storageState: StorageState, outDir: string, fakeMedia?: boolean): Promise<BrowserContext> {
  await mkdir(outDir, { recursive: true });
  const context = await browser.newContext({
    storageState,
    viewport: CONFIG.viewport,
    recordVideo: { dir: outDir, size: CONFIG.viewport },
    ...(fakeMedia ? { permissions: ['camera', 'microphone'] } : {}),
  });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  return context;
}

export async function recordFlow(browser: Browser, options: RecordFlowOptions): Promise<RecordFlowResult> {
  // 1. Setup context: login + preconditions, NOT recorded.
  const setupContext = await options.setup(browser);
  const storageState = await setupContext.storageState();
  await setupContext.close();

  // 2. Recording context: authenticated via storageState, no login in the video.
  const context = await openRecordedContext(browser, storageState, options.outDir, options.fakeMedia);
  const page = await context.newPage();

  await page.goto(options.startUrl);
  await maskRealHost(page);

  const steps = await options.record(page);

  const video = page.video();
  if (!video) throw new Error('Recording context was not created with recordVideo');
  await context.close();
  const webmPath = await video.path();

  return { webmPath, steps };
}

type BoundingBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export async function moveTo(page: Page, box: BoundingBox): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 20 });
}

export async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function moveAndClick(page: Page, locator: Locator, pauseMs = 400): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('moveAndClick: element has no bounding box (not visible?)');
  await moveTo(page, box);
  await pause(pauseMs);
  await locator.click();
}

export async function encodeWebm(webmPath: string, outMp4: string): Promise<void> {
  await mkdir(dirname(outMp4), { recursive: true });
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i',
      webmPath,
      '-vf',
      'scale=1280:-2,format=yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outMp4,
    ]);
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
