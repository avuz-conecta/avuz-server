import { mkdir, rename } from 'node:fs/promises';
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

function runFfmpeg(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [...args]);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function probeDurationSeconds(mp4Path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4Path]);
    let out = '';
    ffprobe.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    ffprobe.on('error', reject);
    ffprobe.on('close', (code) => {
      const seconds = Number.parseFloat(out.trim());
      if (code === 0 && Number.isFinite(seconds)) return resolve(seconds);
      reject(new Error(`ffprobe failed to read duration of ${mp4Path}`));
    });
  });
}

type FreezeSpan = { readonly start: number; readonly end: number };

function lastFreezeSpan(freezeLog: string, videoDurationSeconds: number): FreezeSpan | null {
  const starts = [...freezeLog.matchAll(/freeze_start:\s*([\d.]+)/g)].map((match) => Number.parseFloat(match[1]));
  const ends = [...freezeLog.matchAll(/freeze_end:\s*([\d.]+)/g)].map((match) => Number.parseFloat(match[1]));
  if (starts.length === 0) return null;
  const start = starts[starts.length - 1];
  // A freeze that runs to the end has no matching freeze_end line; ffmpeg emits
  // one only when motion resumes. Fewer ends than starts => the last span is open.
  const end = ends.length < starts.length ? videoDurationSeconds : ends[ends.length - 1];
  return { start, end };
}

// Removes a static tail: a frozen run that reaches (near) the end of the clip
// is trimmed to `tailSeconds` after it began. Camera-off Talk scenes are all
// identical avatar frames, so a long trailing wait reads as a frozen screen;
// this ends the video shortly after the last real motion. No-op when the clip
// does not end on a freeze, so it is safe to run on every capture.
export async function trimTrailingFreeze(mp4Path: string, tailSeconds = 1, minFreezeSeconds = 1.5): Promise<void> {
  const duration = await probeDurationSeconds(mp4Path);
  const freezeLog = await runFfmpeg(['-i', mp4Path, '-vf', 'freezedetect=n=-55dB:d=1', '-map', '0:v:0', '-f', 'null', '-']);
  const span = lastFreezeSpan(freezeLog, duration);
  if (!span) return;
  const reachesEnd = duration - span.end <= 0.6;
  if (!reachesEnd || span.end - span.start < minFreezeSeconds) return;
  const cutSeconds = Math.min(duration, span.start + tailSeconds);
  if (cutSeconds >= duration - 0.1) return;
  const trimmedPath = `${mp4Path}.trimmed.mp4`;
  await runFfmpeg(['-y', '-i', mp4Path, '-t', cutSeconds.toFixed(2), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', trimmedPath]);
  await rename(trimmedPath, mp4Path);
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
