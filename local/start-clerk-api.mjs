import { readFile } from 'node:fs/promises';

function parseJson(text, label) {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function readSecret(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new Error(`${label} is unavailable. Run local setup before starting this mode.`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value;
}

async function start() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('The Clerk local API can run only in development mode.');
  }

  const localDatabaseCredentials = parseJson(await readSecret('/run/secrets/credentials', 'Local database credentials'), 'Local database credentials');
  const clerk = parseJson(await readSecret('/run/secrets/clerk-development', 'Clerk Development credentials'), 'Clerk Development credentials');
  const runtimePassword = requiredString(localDatabaseCredentials.runtimePassword, 'Local database runtime password');
  const secretKey = requiredString(clerk.secretKey, 'Clerk secret key');
  const publishableKey = requiredString(clerk.publishableKey, 'Clerk publishable key');
  const organizationId = requiredString(clerk.operatorOrganizationId, 'Clerk operator organization ID');

  if (!secretKey.startsWith('sk_test_')) throw new Error('The Clerk API key must be a Development secret key beginning with sk_test_.');
  if (!publishableKey.startsWith('pk_test_')) throw new Error('The Clerk API key must be a Development publishable key beginning with pk_test_.');
  if (!organizationId.startsWith('org_')) throw new Error('The configured Internal Operator organization ID is invalid.');

  process.env.CLERK_SECRET_KEY = secretKey;
  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
  process.env.OPERATOR_CLERK_ORGANIZATION_ID = organizationId;
  process.env.OPERATOR_TENANT_ADMIN_DATABASE_URL = `postgres://drezivo_app:${encodeURIComponent(runtimePassword)}@db:5432/operator_local`;
  process.env.OPERATOR_LOCAL_SYNTHETIC = 'true';
  process.env.OPERATOR_CORS_ORIGINS = 'http://localhost:3010,http://127.0.0.1:3010';

  // These integrations are intentionally unavailable in this local mode. Console reads,
  // tenant administration and payment methods all use the local Postgres database.
  for (const name of [
    'INTERNAL_SERVICE_BASE_URL',
    'INTERNAL_SERVICE_AUTH',
    'INTERNAL_OPERATOR_ASSERTION_SECRET',
    'BUSINESS_CLERK_SECRET_KEY',
    'BUSINESS_API_PUBLIC_URL',
    'OPERATOR_PROOF_LINK_SECRET',
    'OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE',
    'OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET',
  ]) {
    delete process.env[name];
  }

  await import('../api/src/server.ts');
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  console.error(`Clerk local API startup failed: ${message}`);
  process.exitCode = 1;
});
