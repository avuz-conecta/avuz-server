import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTaskPage } from './page-writer';
import type { TaskDoc } from './steps';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'page-writer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('writeTaskPage', () => {
  it('writes a clean task doc to <contentRoot>/<app>/<slug>.md and returns the path', async () => {
    const contentRoot = await createTempDir();
    const doc: TaskDoc = {
      title: 'Como compartilhar um arquivo',
      description: 'Envie um link ou convide alguém.',
      app: 'drive',
      slug: 'compartilhar-arquivo',
      order: 1,
      media: 'compartilhar-arquivo.mp4',
      steps: [{ n: 1, text: 'Passe o mouse no arquivo e clique em **Compartilhar**.' }],
    };

    const path = await writeTaskPage(doc, '33.0.8', contentRoot);

    expect(path).toBe(join(contentRoot, 'drive', 'compartilhar-arquivo.md'));
    const written = await readFile(path, 'utf8');
    expect(written).toContain('1. Passe o mouse no arquivo e clique em **Compartilhar**.');
    expect(written).toContain('title: "Como compartilhar um arquivo"');
  });

  it('refuses to write a doc whose content trips the hygiene scan', async () => {
    const contentRoot = await createTempDir();
    const doc: TaskDoc = {
      title: 'Como configurar o Talk',
      description: 'Ajuste as opções de chamada.',
      app: 'talk',
      slug: 'configurar-talk',
      order: 1,
      media: 'configurar-talk.mp4',
      tip: 'Teste primeiro em staging.avuz.app antes de liberar.',
      steps: [{ n: 1, text: 'Abra as configurações.' }],
    };

    await expect(writeTaskPage(doc, '33', contentRoot)).rejects.toThrow(/staging-host/);

    await expect(access(join(contentRoot, 'talk', 'configurar-talk.md'))).rejects.toThrow();
  });
});
