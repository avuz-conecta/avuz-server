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
  calendarsRootUrl,
  calendarUrl,
  resolveDavHref,
  parseCalendarNames,
  parseCalendarObjectHrefs,
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

describe('calendarsRootUrl', () => {
  it('composes the CalDAV calendar-home URL for a user', () => {
    expect(calendarsRootUrl('https://x.app', 'demo.ana')).toBe('https://x.app/remote.php/dav/calendars/demo.ana/');
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(calendarsRootUrl('https://x.app/', 'demo.ana')).toBe('https://x.app/remote.php/dav/calendars/demo.ana/');
  });
});

describe('calendarUrl', () => {
  it('composes a single calendar collection URL', () => {
    expect(calendarUrl('https://x.app', 'demo.ana', 'personal')).toBe(
      'https://x.app/remote.php/dav/calendars/demo.ana/personal/',
    );
  });

  it('composes correctly for a non-default calendar name', () => {
    expect(calendarUrl('https://x.app', 'demo.bruno', 'projeto-x')).toBe(
      'https://x.app/remote.php/dav/calendars/demo.bruno/projeto-x/',
    );
  });
});

describe('resolveDavHref', () => {
  it('joins the origin with an absolute DAV href', () => {
    expect(resolveDavHref('https://x.app', '/remote.php/dav/calendars/demo.ana/personal/abc123.ics')).toBe(
      'https://x.app/remote.php/dav/calendars/demo.ana/personal/abc123.ics',
    );
  });

  it('collapses a trailing slash on baseUrl instead of doubling it', () => {
    expect(resolveDavHref('https://x.app/', '/remote.php/dav/calendars/demo.ana/personal/abc123.ics')).toBe(
      'https://x.app/remote.php/dav/calendars/demo.ana/personal/abc123.ics',
    );
  });
});

describe('parseCalendarNames', () => {
  const multistatus = (hrefs: readonly string[]) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs
      .map((href) => `<d:response><d:href>${href}</d:href></d:response>`)
      .join('')}</d:multistatus>`;

  it('drops the calendar-home root entry and returns decoded names for the rest', () => {
    const xml = multistatus([
      '/remote.php/dav/calendars/demo.ana/',
      '/remote.php/dav/calendars/demo.ana/personal/',
      '/remote.php/dav/calendars/demo.ana/contact_birthdays/',
      '/remote.php/dav/calendars/demo.ana/reuni%c3%b5es/',
    ]);
    expect(parseCalendarNames(xml, 'demo.ana')).toEqual(['personal', 'contact_birthdays', 'reuniões']);
  });

  it('returns an empty list when only the calendar-home root entry is present', () => {
    const xml = multistatus(['/remote.php/dav/calendars/demo.ana/']);
    expect(parseCalendarNames(xml, 'demo.ana')).toEqual([]);
  });
});

describe('parseCalendarObjectHrefs', () => {
  const multistatus = (hrefs: readonly string[]) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs
      .map((href) => `<d:response><d:href>${href}</d:href></d:response>`)
      .join('')}</d:multistatus>`;

  it('keeps only .ics object hrefs, dropping the calendar collection href itself', () => {
    const xml = multistatus([
      '/remote.php/dav/calendars/demo.ana/personal/',
      '/remote.php/dav/calendars/demo.ana/personal/event-1.ics',
      '/remote.php/dav/calendars/demo.ana/personal/event-2.ics',
    ]);
    expect(parseCalendarObjectHrefs(xml, 'demo.ana', 'personal')).toEqual([
      '/remote.php/dav/calendars/demo.ana/personal/event-1.ics',
      '/remote.php/dav/calendars/demo.ana/personal/event-2.ics',
    ]);
  });

  it('returns an empty list for an empty calendar', () => {
    const xml = multistatus(['/remote.php/dav/calendars/demo.ana/personal/']);
    expect(parseCalendarObjectHrefs(xml, 'demo.ana', 'personal')).toEqual([]);
  });

  it('ignores objects belonging to a different calendar', () => {
    const xml = multistatus([
      '/remote.php/dav/calendars/demo.ana/personal/',
      '/remote.php/dav/calendars/demo.ana/projeto-x/event-1.ics',
    ]);
    expect(parseCalendarObjectHrefs(xml, 'demo.ana', 'personal')).toEqual([]);
  });
});
