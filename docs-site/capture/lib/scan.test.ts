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
  it('flags the bare production meet host', () => {
    const hits = scanText('a.md', 'meet.avuz.app');
    expect(hits.map((h) => h.rule)).toContain('meet-host');
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
  it('still flags a numbered meet host', () => {
    const hits = scanText('a.md', 'meet04.avuz.app');
    expect(hits.map((h) => h.rule)).toContain('meet-host');
  });
  it('passes a pt-BR date that looks like a version string', () => {
    expect(scanText('a.md', 'Reunião em 09.09.2026 às 14h')).toHaveLength(0);
  });
  it('still flags a real Nextcloud version string', () => {
    const hits = scanText('a.md', 'Nextcloud Hub 33.0.8');
    expect(hits.map((h) => h.rule)).toContain('nc-version');
  });
  it('flags an internal host', () => {
    const hits = scanText('a.md', 'use registry.avuz.app aqui');
    expect(hits.map((h) => h.rule)).toContain('internal-host');
  });
  it('passes common Portuguese prose containing "garra"', () => {
    expect(scanText('a.md', 'trabalhe com garra e dedicação')).toHaveLength(0);
  });
});
