import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stepsToMarkdown, type TaskDoc } from './steps';
import { scanText } from './scan';

export async function writeTaskPage(doc: TaskDoc, version: string, contentRoot: string): Promise<string> {
  const markdown = stepsToMarkdown(doc, version);
  const relative = `${doc.app}/${doc.slug}.md`;
  const hits = scanText(relative, markdown);
  if (hits.length > 0) {
    throw new Error(`hygiene scan failed for ${relative}: ${hits.map((h) => `${h.rule}:${h.match}`).join(', ')}`);
  }
  const path = join(contentRoot, doc.app, `${doc.slug}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, 'utf8');
  return path;
}
