function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export const CONFIG = {
  stagingUrl: required('STAGING_URL'),
  stagingUser: required('STAGING_USER'),
  stagingAppPassword: required('STAGING_APP_PASSWORD'),
  demoUserPassword: required('DEMO_USER_PASSWORD'),
  demoDomain: process.env.DEMO_DOMAIN ?? 'conecta.demo',
  tenant: 'Conecta Demo Ltda',
  viewport: { width: 1280, height: 800 },
} as const;
