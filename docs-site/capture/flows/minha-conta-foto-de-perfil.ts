import { deflateSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Flow } from '../run';
import { login } from '../lib/browser';
import { CONFIG } from '../config';
import { moveAndClick, pause } from '../lib/screencast';
import type { Step } from '../lib/steps';

const AVATAR_FILE_NAME = 'avatar.png';
const AVATAR_SIZE = 240;
const AVATAR_COLOR: readonly [number, number, number] = [43, 181, 227]; // Avuz brand blue

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

// Builds a minimal, valid solid-color square PNG (8-bit RGB, no filters/palette)
// without pulling in an image library — same spirit as the hand-rolled PDF/vCard
// builders in the other flows.
function buildSquarePng(size: number, color: readonly [number, number, number]): Buffer {
  const [red, green, blue] = color;
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const rowBytes = 1 + size * 3;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const pixelStart = rowStart + 1 + x * 3;
      raw[pixelStart] = red;
      raw[pixelStart + 1] = green;
      raw[pixelStart + 2] = blue;
    }
  }

  const ihdr = pngChunk('IHDR', ihdrData);
  const idat = pngChunk('IDAT', deflateSync(raw));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

async function createTempAvatarPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'avuz-capture-avatar-'));
  const filePath = join(dir, AVATAR_FILE_NAME);
  await writeFile(filePath, new Uint8Array(buildSquarePng(AVATAR_SIZE, AVATAR_COLOR)));
  return filePath;
}

async function setup(browser: Browser): Promise<BrowserContext> {
  const { context } = await login(browser, 'demo.ana', CONFIG.demoUserPassword);
  return context;
}

async function record(page: Page): Promise<readonly Step[]> {
  const heading = page.getByRole('heading', { name: 'Imagem do perfil', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 20000 });
  await pause(600);

  const uploadButton = page.getByRole('button', { name: 'Fazer upload da foto do perfil', exact: true });
  await uploadButton.waitFor({ state: 'visible', timeout: 10000 });
  await moveAndClick(page, uploadButton, 500);

  const tempFilePath = await createTempAvatarPng();
  try {
    const fileInput = page.locator('#vue-avatar-section input[type="file"]');
    await fileInput.setInputFiles(tempFilePath);
    await pause(700);

    const confirmButton = page.getByRole('button', { name: 'Definir como imagem do perfil', exact: true });
    await confirmButton.waitFor({ state: 'visible', timeout: 15000 });
    await pause(900);

    await moveAndClick(page, confirmButton, 500);
    await confirmButton.waitFor({ state: 'hidden', timeout: 15000 });

    const updatedAvatar = page.locator('#vue-avatar-section .avatar__preview img');
    await updatedAvatar.waitFor({ state: 'visible', timeout: 15000 });
    await pause(1200);
  } finally {
    await rm(dirname(tempFilePath), { recursive: true, force: true });
  }

  return [
    { n: 1, text: 'Em **Minha conta**, clique em **Fazer upload da foto do perfil**.' },
    { n: 2, text: 'Escolha uma imagem **PNG** ou **JPG** no seu computador.' },
    { n: 3, text: 'Ajuste o recorte da imagem e clique em **Definir como imagem do perfil**.' },
    { n: 4, text: 'Sua nova foto de perfil aparece imediatamente na tela.' },
  ];
}

export const flow: Flow = {
  capturedForVersion: '33.0.8',
  app: 'minha-conta',
  slug: 'foto-de-perfil',
  title: 'Como mudar a foto de perfil',
  description: 'Personalize sua conta com uma foto de perfil.',
  tip: 'Uma foto ajuda seus colegas a reconhecerem você nas conversas e comentários.',
  order: 1,
  startUrl: `${CONFIG.stagingUrl}/settings/user`,
  setup,
  record,
};
