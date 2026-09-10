import { describe, it, expect } from 'vitest';
import {
  webdavUrl,
  webdavRootUrl,
  trashbinEmptyUrl,
  deckBoardsUrl,
  deckBoardUrl,
  spreedRoomsUrl,
  spreedRoomUrl,
  parseDavEntryNames,
} from './seed';

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

describe('webdavRootUrl', () => {
  it('composes the WebDAV root URL for a user, trailing slash included', () => {
    expect(webdavRootUrl('https://x.app', 'demo.ana')).toBe('https://x.app/remote.php/dav/files/demo.ana/');
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(webdavRootUrl('https://x.app/', 'demo.ana')).toBe('https://x.app/remote.php/dav/files/demo.ana/');
  });
});

describe('trashbinEmptyUrl', () => {
  it('composes the trash-empty URL for a user', () => {
    expect(trashbinEmptyUrl('https://x.app', 'demo.ana')).toBe('https://x.app/remote.php/dav/trashbin/demo.ana/trash');
  });
});

describe('deckBoardsUrl', () => {
  it('composes the Deck boards list URL', () => {
    expect(deckBoardsUrl('https://x.app')).toBe('https://x.app/index.php/apps/deck/api/v1.0/boards');
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(deckBoardsUrl('https://x.app/')).toBe('https://x.app/index.php/apps/deck/api/v1.0/boards');
  });
});

describe('deckBoardUrl', () => {
  it('composes a single Deck board URL', () => {
    expect(deckBoardUrl('https://x.app', 42)).toBe('https://x.app/index.php/apps/deck/api/v1.0/boards/42');
  });
});

describe('spreedRoomsUrl', () => {
  it('composes the Talk room list URL', () => {
    expect(spreedRoomsUrl('https://x.app')).toBe('https://x.app/ocs/v2.php/apps/spreed/api/v4/room');
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(spreedRoomsUrl('https://x.app/')).toBe('https://x.app/ocs/v2.php/apps/spreed/api/v4/room');
  });
});

describe('spreedRoomUrl', () => {
  it('composes a single Talk room URL by token', () => {
    expect(spreedRoomUrl('https://x.app', 'bhwbje3o')).toBe('https://x.app/ocs/v2.php/apps/spreed/api/v4/room/bhwbje3o');
  });
});

describe('parseDavEntryNames', () => {
  const multistatus = (hrefs: readonly string[]) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs
      .map((href) => `<d:response><d:href>${href}</d:href></d:response>`)
      .join('')}</d:multistatus>`;

  it('drops the root entry and returns decoded names for the rest', () => {
    const xml = multistatus([
      '/remote.php/dav/files/demo.ana/',
      '/remote.php/dav/files/demo.ana/relatorio.pdf',
      '/remote.php/dav/files/demo.ana/Projetos/',
      '/remote.php/dav/files/demo.ana/Ata%20da%20reuni%c3%a3o.docx',
    ]);
    expect(parseDavEntryNames(xml, 'demo.ana')).toEqual(['relatorio.pdf', 'Projetos', 'Ata da reunião.docx']);
  });

  it('returns an empty list when only the root entry is present', () => {
    const xml = multistatus(['/remote.php/dav/files/demo.ana/']);
    expect(parseDavEntryNames(xml, 'demo.ana')).toEqual([]);
  });

  it('only strips the exact root href, keeping the last path segment for everything else', () => {
    const xml = multistatus(['/remote.php/dav/files/demo.ana/', '/remote.php/dav/files/demo.ana2/arquivo.pdf']);
    expect(parseDavEntryNames(xml, 'demo.ana')).toEqual(['arquivo.pdf']);
  });
});
