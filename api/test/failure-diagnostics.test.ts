import { afterEach, describe, expect, it, vi } from 'vitest';
import { logStartupFailure, postgresFailureReason } from '../src/shared/logging/failure-diagnostics.js';
import { logger } from '../src/shared/logging/logger.js';

afterEach(() => vi.restoreAllMocks());

describe('failure diagnostics', () => {
  it('classifies common PostgreSQL configuration and connectivity failures', () => {
    expect(postgresFailureReason({ code: '28P01' })).toBe('authentication_failed');
    expect(postgresFailureReason({ code: '42501' })).toBe('permission_denied');
    expect(postgresFailureReason({ code: '42P01' })).toBe('schema_unavailable');
    expect(postgresFailureReason({ code: '08006' })).toBe('connection_failed');
    expect(postgresFailureReason({ code: 'OTHER' })).toBe('database_error');
  });

  it('logs startup configuration errors with safe fields and no path or message', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const cause = Object.assign(new Error('ENOENT /etc/secrets/supabase-ca.crt'), { code: 'ENOENT' });

    logStartupFailure(cause, {
      phase: 'composition', dependency: 'tenant_admin_database', reason: 'ca_file_unreadable',
      configurationKeys: ['OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE', 'password=secret'],
    });

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'api.config.startup_failed', phase: 'composition', dependency: 'tenant_admin_database',
      reason: 'ca_file_unreadable', configuration_keys: ['OPERATOR_TENANT_ADMIN_DATABASE_CA_FILE'],
      error: { name: 'Error', code: 'ENOENT' },
    }), 'API startup configuration failed');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('/etc/secrets');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('secret');
  });
});
