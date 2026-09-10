export type DemoUser = { readonly uid: string; readonly displayName: string };

export type DemoTenant = { readonly users: readonly string[]; readonly driveFile: string };

export const DEMO_USERS: readonly DemoUser[] = [
  { uid: 'demo.ana', displayName: 'Ana Souza' },
  { uid: 'demo.bruno', displayName: 'Bruno Lima' },
];

const DRIVE_FILE = 'relatorio.pdf';

export function webdavUrl(baseUrl: string, uid: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/remote.php/dav/files/${uid}/${path}`;
}

function minimalPdf(): string {
  return [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
}

function basicAuthHeader(uid: string, password: string): string {
  return `Basic ${Buffer.from(`${uid}:${password}`).toString('base64')}`;
}

async function deleteDemoFile(stagingUrl: string, demoUserPassword: string): Promise<void> {
  const response = await fetch(webdavUrl(stagingUrl, 'demo.ana', DRIVE_FILE), {
    method: 'DELETE',
    headers: { Authorization: basicAuthHeader('demo.ana', demoUserPassword) },
  });
  if (response.ok || response.status === 404) return;
  throw new Error(`Failed to delete ${DRIVE_FILE}: ${response.status}`);
}

async function putDemoFile(stagingUrl: string, demoUserPassword: string): Promise<void> {
  const response = await fetch(webdavUrl(stagingUrl, 'demo.ana', DRIVE_FILE), {
    method: 'PUT',
    headers: {
      Authorization: basicAuthHeader('demo.ana', demoUserPassword),
      'Content-Type': 'application/pdf',
    },
    body: minimalPdf(),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to put ${DRIVE_FILE}: ${response.status}`);
}

export async function resetTenant(): Promise<DemoTenant> {
  const { CONFIG } = await import('../config');
  await deleteDemoFile(CONFIG.stagingUrl, CONFIG.demoUserPassword);
  await putDemoFile(CONFIG.stagingUrl, CONFIG.demoUserPassword);
  return { users: DEMO_USERS.map((u) => u.uid), driveFile: DRIVE_FILE };
}
