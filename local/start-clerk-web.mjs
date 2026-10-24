import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

async function start() {
  let publishable;
  try {
    const text = await readFile('/run/secrets/clerk-publishable', 'utf8');
    publishable = JSON.parse(text.replace(/^\uFEFF/, '')).publishableKey;
  } catch {
    throw new Error('The local Clerk publishable key is unavailable. Run local Clerk setup before starting this mode.');
  }

  if (typeof publishable !== 'string' || !publishable.startsWith('pk_test_')) {
    throw new Error('The local Clerk publishable key must be a Development key beginning with pk_test_.');
  }

  const child = spawn('npm', ['run', 'dev', '--workspace', '@drezivo/operator-web', '--', '--hostname', '0.0.0.0', '--webpack'], {
    cwd: '/workspace',
    env: {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
      NEXT_PUBLIC_OPERATOR_LOCAL_MODE: 'false',
      NEXT_PUBLIC_DREZIVO_API_BASE_URL: 'http://localhost:5080/api/v1',
    },
    stdio: 'inherit',
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }

  child.once('error', () => {
    console.error('Could not start the local Operator Web development server.');
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = signal ? 1 : code ?? 1;
  });
}

start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  console.error(`Clerk local web startup failed: ${message}`);
  process.exitCode = 1;
});
