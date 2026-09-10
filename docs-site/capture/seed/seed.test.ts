import { describe, it, expect } from 'vitest';
import { webdavUrl } from './seed';

describe('webdavUrl', () => {
  it('composes the WebDAV files URL for a user and path', () => {
    expect(webdavUrl('https://x.app', 'demo.ana', 'relatorio.pdf')).toBe(
      'https://x.app/remote.php/dav/files/demo.ana/relatorio.pdf',
    );
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(webdavUrl('https://x.app/', 'demo.ana', 'relatorio.pdf')).toBe(
      'https://x.app/remote.php/dav/files/demo.ana/relatorio.pdf',
    );
  });

  it('composes correctly for a different uid and path', () => {
    expect(webdavUrl('https://staging.example', 'demo.bruno', 'notas/reuniao.pdf')).toBe(
      'https://staging.example/remote.php/dav/files/demo.bruno/notas/reuniao.pdf',
    );
  });
});
