import { describe, it, expect } from 'vitest';
import { scanText } from './scan';

describe('scanText', () => {
  it('flags real staging hostnames', () => {
    const hits = scanText('a.md', 'abra staging.avuz.app no navegador');
    expect(hits.map((h) => h.rule)).toContain('staging-host');
  });
  it('flags HPB meet hostnames', () => {
    expect(scanText('a.md', 'meet04.avuz.app').length).toBeGreaterThan(0);
  });
  it('flags a Nextcloud version string', () => {
    expect(scanText('a.md', 'Nextcloud Hub 33.0.8').length).toBeGreaterThan(0);
  });
  it('flags a known real client name', () => {
    const hits = scanText('a.md', 'exemplo grupo-vidalar aqui');
    expect(hits.map((h) => h.rule)).toContain('client-name');
  });
  it('passes clean demo content', () => {
    expect(scanText('a.md', 'Abra conecta.demo e clique em Compartilhar')).toHaveLength(0);
  });
});
