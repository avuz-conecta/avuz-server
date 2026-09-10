export type DemoUser = { readonly uid: string; readonly displayName: string };

export type DemoTenant = { readonly users: readonly string[]; readonly driveFile: string };

export const DEMO_USERS: readonly DemoUser[] = [
  { uid: 'demo.ana', displayName: 'Ana Souza' },
  { uid: 'demo.bruno', displayName: 'Bruno Lima' },
];

const DRIVE_FILE = 'relatorio.pdf';
const DRIVE_OWNER = 'demo.ana';

function stripTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function webdavUrl(baseUrl: string, uid: string, path: string): string {
  return `${stripTrailingSlash(baseUrl)}/remote.php/dav/files/${uid}/${path}`;
}

export function webdavRootUrl(baseUrl: string, uid: string): string {
  return `${stripTrailingSlash(baseUrl)}/remote.php/dav/files/${uid}/`;
}

export function trashbinEmptyUrl(baseUrl: string, uid: string): string {
  return `${stripTrailingSlash(baseUrl)}/remote.php/dav/trashbin/${uid}/trash`;
}

export function deckBoardsUrl(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/index.php/apps/deck/api/v1.0/boards`;
}

export function deckBoardUrl(baseUrl: string, boardId: number): string {
  return `${deckBoardsUrl(baseUrl)}/${boardId}`;
}

export function spreedRoomsUrl(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}/ocs/v2.php/apps/spreed/api/v4/room`;
}

export function spreedRoomUrl(baseUrl: string, token: string): string {
  return `${spreedRoomsUrl(baseUrl)}/${token}`;
}

function davRootHref(uid: string): string {
  return `/remote.php/dav/files/${uid}/`;
}

const DAV_HREF_PATTERN = /<d:href>([^<]+)<\/d:href>/g;

export function parseDavEntryNames(xml: string, uid: string): readonly string[] {
  const root = davRootHref(uid);
  const names: string[] = [];
  for (const match of xml.matchAll(DAV_HREF_PATTERN)) {
    const href = match[1];
    if (href === root) continue;
    const trimmed = href.endsWith('/') ? href.slice(0, -1) : href;
    const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    names.push(decodeURIComponent(lastSegment));
  }
  return names;
}

function minimalPdf(): Buffer {
  const header = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ];
  let body = header;
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

function basicAuthHeader(uid: string, password: string): string {
  return `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
}

function davHeaders(uid: string, password: string): HeadersInit {
  return { Authorization: basicAuthHeader(uid, password) };
}

function ocsHeaders(uid: string, password: string): HeadersInit {
  return {
    Authorization: basicAuthHeader(uid, password),
    'OCS-APIRequest': 'true',
    Accept: 'application/json',
  };
}

async function loadConfig() {
  return (await import('../config')).CONFIG;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type DeckBoard = { readonly id: number; readonly deletedAt: number };

function toDeckBoard(value: unknown): DeckBoard | undefined {
  if (!isRecord(value)) return undefined;
  const { id, deletedAt } = value;
  if (typeof id !== 'number' || typeof deletedAt !== 'number') return undefined;
  return { id, deletedAt };
}

async function fetchActiveDeckBoards(stagingUrl: string, uid: string, password: string): Promise<readonly DeckBoard[]> {
  const response = await fetch(deckBoardsUrl(stagingUrl), { headers: ocsHeaders(uid, password) });
  if (!response.ok) return [];
  const body: unknown = await response.json();
  if (!Array.isArray(body)) return [];
  const boards: DeckBoard[] = [];
  for (const item of body) {
    const board = toDeckBoard(item);
    if (board && board.deletedAt === 0) boards.push(board);
  }
  return boards;
}

async function deleteDeckBoard(stagingUrl: string, uid: string, password: string, boardId: number): Promise<void> {
  const response = await fetch(deckBoardUrl(stagingUrl, boardId), {
    method: 'DELETE',
    headers: ocsHeaders(uid, password),
  });
  if (response.ok) return;
  console.warn(`seed: could not delete Deck board ${boardId} for ${uid} (status ${response.status})`);
}

async function teardownDeckBoards(stagingUrl: string, uid: string, password: string): Promise<void> {
  const boards = await fetchActiveDeckBoards(stagingUrl, uid, password);
  for (const board of boards) {
    await deleteDeckBoard(stagingUrl, uid, password, board.id);
  }
}

type SpreedRoom = { readonly token: string };

function toSpreedRoom(value: unknown): SpreedRoom | undefined {
  if (!isRecord(value)) return undefined;
  const { token } = value;
  if (typeof token !== 'string') return undefined;
  return { token };
}

async function fetchSpreedRooms(stagingUrl: string, uid: string, password: string): Promise<readonly SpreedRoom[]> {
  const response = await fetch(spreedRoomsUrl(stagingUrl), { headers: ocsHeaders(uid, password) });
  if (!response.ok) return [];
  const body: unknown = await response.json();
  if (!isRecord(body)) return [];
  const ocs = body.ocs;
  if (!isRecord(ocs)) return [];
  const data = ocs.data;
  if (!Array.isArray(data)) return [];
  const rooms: SpreedRoom[] = [];
  for (const item of data) {
    const room = toSpreedRoom(item);
    if (room) rooms.push(room);
  }
  return rooms;
}

async function deleteSpreedRoom(stagingUrl: string, uid: string, password: string, token: string): Promise<void> {
  const response = await fetch(spreedRoomUrl(stagingUrl, token), {
    method: 'DELETE',
    headers: ocsHeaders(uid, password),
  });
  if (response.ok) return;
  console.warn(`seed: could not delete Talk room ${token} for ${uid} (status ${response.status})`);
}

async function teardownTalkRooms(stagingUrl: string, uid: string, password: string): Promise<void> {
  const rooms = await fetchSpreedRooms(stagingUrl, uid, password);
  for (const room of rooms) {
    await deleteSpreedRoom(stagingUrl, uid, password, room.token);
  }
}

async function fetchDriveEntryNames(stagingUrl: string, uid: string, password: string): Promise<readonly string[]> {
  const response = await fetch(webdavRootUrl(stagingUrl, uid), {
    method: 'PROPFIND',
    headers: { ...davHeaders(uid, password), Depth: '1' },
  });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseDavEntryNames(xml, uid);
}

async function deleteDriveEntry(stagingUrl: string, uid: string, password: string, name: string): Promise<void> {
  const response = await fetch(webdavUrl(stagingUrl, uid, encodeURIComponent(name)), {
    method: 'DELETE',
    headers: davHeaders(uid, password),
  });
  if (response.ok || response.status === 404) return;
  console.warn(`seed: could not delete Drive entry "${name}" for ${uid} (status ${response.status})`);
}

async function emptyTrash(stagingUrl: string, uid: string, password: string): Promise<void> {
  const response = await fetch(trashbinEmptyUrl(stagingUrl, uid), {
    method: 'DELETE',
    headers: davHeaders(uid, password),
  });
  if (response.ok) return;
  console.warn(`seed: could not empty trash for ${uid} (status ${response.status})`);
}

async function teardownDriveClutter(stagingUrl: string, password: string): Promise<void> {
  const names = await fetchDriveEntryNames(stagingUrl, DRIVE_OWNER, password);
  for (const name of names) {
    if (name === DRIVE_FILE) continue;
    await deleteDriveEntry(stagingUrl, DRIVE_OWNER, password, name);
  }
  await emptyTrash(stagingUrl, DRIVE_OWNER, password);
}

async function deleteDemoFile(stagingUrl: string, demoUserPassword: string): Promise<void> {
  const response = await fetch(webdavUrl(stagingUrl, DRIVE_OWNER, DRIVE_FILE), {
    method: 'DELETE',
    headers: davHeaders(DRIVE_OWNER, demoUserPassword),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(`Failed to delete ${DRIVE_FILE}: ${response.status}`);
}

async function putDemoFile(stagingUrl: string, demoUserPassword: string): Promise<void> {
  const response = await fetch(webdavUrl(stagingUrl, DRIVE_OWNER, DRIVE_FILE), {
    method: 'PUT',
    headers: {
      ...davHeaders(DRIVE_OWNER, demoUserPassword),
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(minimalPdf()),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to put ${DRIVE_FILE}: ${response.status}`);
}

async function teardownCategory(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.warn(`seed: ${label} teardown failed, continuing`, error);
  }
}

async function teardownUserWorkspaces(stagingUrl: string, password: string): Promise<void> {
  for (const user of DEMO_USERS) {
    await teardownCategory(`Deck boards (${user.uid})`, () => teardownDeckBoards(stagingUrl, user.uid, password));
    await teardownCategory(`Talk rooms (${user.uid})`, () => teardownTalkRooms(stagingUrl, user.uid, password));
  }
  await teardownCategory('Drive clutter (demo.ana)', () => teardownDriveClutter(stagingUrl, password));
}

export async function resetTenant(): Promise<DemoTenant> {
  const config = await loadConfig();
  await teardownUserWorkspaces(config.stagingUrl, config.demoUserPassword);
  await deleteDemoFile(config.stagingUrl, config.demoUserPassword);
  await putDemoFile(config.stagingUrl, config.demoUserPassword);
  return { users: DEMO_USERS.map((u) => u.uid), driveFile: DRIVE_FILE };
}
