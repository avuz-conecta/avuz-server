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

async function loadConfig() {
  return (await import('../config')).CONFIG;
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
    body: new Uint8Array(minimalPdf()),
  });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`Failed to put ${DRIVE_FILE}: ${response.status}`);
}

export async function resetTenant(): Promise<DemoTenant> {
  const config = await loadConfig();
  await deleteDemoFile(config.stagingUrl, config.demoUserPassword);
  await putDemoFile(config.stagingUrl, config.demoUserPassword);
  return { users: DEMO_USERS.map((u) => u.uid), driveFile: DRIVE_FILE };
}
