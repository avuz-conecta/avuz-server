import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export function flowFilesFrom(entries: readonly string[]): readonly string[] {
  return entries
    .filter(entry => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .sort();
}

async function runFlow(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', ['capture/run.ts', filePath], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Flow failed: ${filePath} (exit ${code})`));
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  const flowsDir = join(process.cwd(), 'capture/flows');
  const entries = await readdir(flowsDir);
  const flowFiles = flowFilesFrom(entries);

  if (flowFiles.length === 0) {
    console.log('✓ no flows to capture');
    return;
  }

  for (const flowFile of flowFiles) {
    await runFlow(`./flows/${flowFile}`);
  }

  console.log(`✓ captured ${flowFiles.length} flows`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
