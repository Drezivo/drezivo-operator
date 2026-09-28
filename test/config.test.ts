import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDevelopmentLoopbackHttpConfiguration, resolveClerkEnvironment } from '../src/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Clerk environment configuration', () => {
  it('normalizes the keys supplied to the Operator API to Clerk Express names', () => {
    expect(resolveClerkEnvironment({
      NEXT_CLERK_SECRET_KEY: 'test-secret',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'test-publishable',
    })).toEqual({ CLERK_SECRET_KEY: 'test-secret', CLERK_PUBLISHABLE_KEY: 'test-publishable' });
  });

  it('accepts canonical names and rejects conflicting aliases without disclosing values', () => {
    expect(resolveClerkEnvironment({ CLERK_SECRET_KEY: 'same', NEXT_CLERK_SECRET_KEY: 'same' }).CLERK_SECRET_KEY).toBe('same');
    let message = '';
    try {
      resolveClerkEnvironment({ CLERK_SECRET_KEY: 'canonical-test-secret', NEXT_CLERK_SECRET_KEY: 'alias-test-secret' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('CLERK_SECRET_KEY');
    expect(message).not.toContain('canonical-test-secret');
    expect(message).not.toContain('alias-test-secret');
  });

  it('rejects conflicting canonical and public publishable-key aliases without disclosing either value', () => {
    let message = '';
    try {
      resolveClerkEnvironment({
        CLERK_PUBLISHABLE_KEY: 'pk-canonical-test-value',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk-alias-test-value',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('CLERK_PUBLISHABLE_KEY');
    expect(message).not.toContain('pk-canonical-test-value');
    expect(message).not.toContain('pk-alias-test-value');
  });

  it.each([
    ['missing publishable key', 'test-secret', undefined],
    ['missing secret key', undefined, 'test-publishable'],
  ])('keeps Clerk authorization unavailable with an incomplete key pair (%s)', async (_caseName, secretKey, publishableKey) => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CLERK_SECRET_KEY', secretKey);
    vi.stubEnv('NEXT_CLERK_SECRET_KEY', secretKey);
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', publishableKey);
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', publishableKey);
    vi.stubEnv('OPERATOR_CLERK_ORGANIZATION_ID', 'org_test_only');
    vi.resetModules();

    const { isClerkConfigured } = await import('../src/config.js');
    expect(isClerkConfigured()).toBe(false);
  });
});

describe('operator API bind configuration', () => {
  it('rejects hosts outside the deployed and local loopback addresses', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('OPERATOR_API_HOST', '0.0.0.0.example');
    vi.resetModules();

    await expect(import('../src/config.js')).rejects.toThrow('OPERATOR_API_HOST');
  });
});

describe('internal service transport configuration', () => {
  it('allows opt-in HTTP only for loopback URLs in development', () => {
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://localhost:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://127.0.0.1:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://[::1]:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://127.1:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://127.000.000.001:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://2130706433:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://0x7f000001:5081/' })).toBe(true);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://[0:0:0:0:0:0:0:1]:5081/' })).toBe(true);
  });

  it('rejects missing opt-in, production mode, and non-loopback or malformed targets', () => {
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: false, baseUrl: 'http://localhost:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'production', enabled: true, baseUrl: 'http://localhost:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://business.internal:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://localhost:5081/api' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://user@localhost:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'https://localhost:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://localhost.:5081/' })).toBe(false);
    expect(isDevelopmentLoopbackHttpConfiguration({ nodeEnv: 'development', enabled: true, baseUrl: 'http://localhost.evil:5081/' })).toBe(false);
  });
});

describe('secret and database configuration rules', () => {
  it('rejects an internal service credential shorter than 32 bytes without echoing it', async () => {
    vi.stubEnv('INTERNAL_SERVICE_AUTH', 'short-secret-value');
    await expect(import('../src/config.js')).rejects.toThrow(/INTERNAL_SERVICE_AUTH/);
    vi.resetModules();
    vi.stubEnv('INTERNAL_SERVICE_AUTH', 'x'.repeat(32));
    await expect(import('../src/config.js')).resolves.toBeDefined();
  });

  it('requires a CA certificate for the tenant-admin database in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPERATOR_CORS_ORIGINS', 'https://operator.example.com');
    vi.stubEnv('OPERATOR_TENANT_ADMIN_DATABASE_URL', 'postgres://drezivo_app:pw@db.example.com:6543/postgres');
    await expect(import('../src/config.js')).rejects.toThrow(/OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE/);
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OPERATOR_TENANT_ADMIN_DATABASE_URL', 'mysql://nope');
    await expect(import('../src/config.js')).rejects.toThrow(/OPERATOR_TENANT_ADMIN_DATABASE_URL/);
  });
});
