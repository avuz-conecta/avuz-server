import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type ScanHit = { readonly file: string; readonly match: string; readonly rule: string };

const CLIENT_NAMES: readonly string[] = [
  'grupo-vidalar', 'endopasso', 'garra', 'eco-ambiental', 'digrepal',
  'comprev', 'abvtex', 'coprel', 'adyl', 'raíven', 'raiven',
];

const RULES: readonly { readonly rule: string; readonly re: RegExp }[] = [
  { rule: 'staging-host', re: /\b(staging|app\d+|avuzapp\d+)\.avuz\.(app|cloud)\b/gi },
  { rule: 'meet-host', re: /\bmeet\d+\.avuz\.(app|cloud)\b/gi },
  { rule: 'internal-host', re: /\b(proxy|registry|s3-site[ab])\.avuz\.(app|cloud|com)\b/gi },
  { rule: 'nc-version', re: /\b(nextcloud[^\n]{0,12})?\b\d{2}\.\d+\.\d+\b/gi },
  { rule: 'client-name', re: new RegExp(`\\b(${CLIENT_NAMES.join('|')})\\b`, 'gi') },
];

export function scanText(file: string, text: string): readonly ScanHit[] {
  const hits: ScanHit[] = [];
  for (const { rule, re } of RULES) {
    for (const match of text.matchAll(re)) {
      hits.push({ file, match: match[0], rule });
    }
  }
  return hits;
}

async function walk(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return [full];
    }),
  );
  return nested.flat();
}

export async function scanTree(root: string): Promise<readonly ScanHit[]> {
  const files = await walk(root);
  const hits: ScanHit[] = [];
  for (const file of files) {
    hits.push(...scanText(file, file));
    if (/\.(md|mdx)$/.test(file)) {
      hits.push(...scanText(file, await readFile(file, 'utf8')));
    }
  }
  return hits;
}

async function main(): Promise<void> {
  const root = process.argv[2] ?? 'src';
  await stat(root);
  const hits = await scanTree(root);
  if (hits.length > 0) {
    for (const hit of hits) console.error(`✗ [${hit.rule}] ${hit.file}: "${hit.match}"`);
    process.exit(1);
  }
  console.log('✓ hygiene scan clean');
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
