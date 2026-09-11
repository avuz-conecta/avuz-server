import { describe, it, expect } from 'vitest';
import { flowFilesFrom } from './run-all';

describe('flowFilesFrom', () => {
  it('filters out test files and non-ts files', () => {
    const entries = [
      'drive-x.ts',
      'talk-y.ts',
      'helper.test.ts',
      'readme.md',
    ];
    const result = flowFilesFrom(entries);
    expect(result).toEqual(['drive-x.ts', 'talk-y.ts']);
  });

  it('returns empty array for empty listing', () => {
    const result = flowFilesFrom([]);
    expect(result).toEqual([]);
  });

  it('sorts results', () => {
    const entries = ['zebra.ts', 'apple.ts', 'beta.ts'];
    const result = flowFilesFrom(entries);
    expect(result).toEqual(['apple.ts', 'beta.ts', 'zebra.ts']);
  });

  it('handles mixed content', () => {
    const entries = [
      'flow-c.ts',
      'flow-a.test.ts',
      'lib.ts',
      'notes.md',
      'flow-b.ts',
      '.hidden.ts',
    ];
    const result = flowFilesFrom(entries);
    expect(result).toEqual(['.hidden.ts', 'flow-b.ts', 'flow-c.ts', 'lib.ts']);
  });
});
