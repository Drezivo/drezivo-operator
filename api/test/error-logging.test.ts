import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../src/shared/http/errors.js';
import { errorHandler, recordRoutePrefix, requestId } from '../src/shared/http/middleware.js';
import { logger } from '../src/shared/logging/logger.js';

type FakeResponse = { locals: { requestId: string }; statusCode: number; body: unknown; setHeader(): void; status(code: number): FakeResponse; json(body: unknown): FakeResponse };

const handle = (
  error: unknown,
  route: { method?: string; baseUrl?: string; path?: string } = {},
): FakeResponse => {
  const res: FakeResponse = {
    locals: { requestId: 'req-1' },
    statusCode: 0,
    body: undefined,
    setHeader: () => undefined,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
  };
  const req = {
    method: route.method ?? 'GET',
    baseUrl: route.baseUrl ?? '/api/v1',
    route: route.path ? { path: route.path } : undefined,
  } as unknown as Request;
  errorHandler(error, req, res as unknown as Response, (() => undefined) as NextFunction);
  return res;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('server failure logging', () => {
  it('uses the Express route template and omits path IDs and query values', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = express();
    const router = express.Router();
    router.post('/tenants/:tenantId/trial', (_req, _res, next) => next(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is unavailable.')));
    app.use(requestId);
    app.use('/api/v1', recordRoutePrefix('/api/v1'), router);
    app.use(errorHandler);

    const response = await request(app).post('/api/v1/tenants/11111111-1111-4111-8111-111111111111/trial?token=private-value');

    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST', route: '/api/v1/tenants/:tenantId/trial',
      request_id: response.body.request_id,
    }), 'API request failed');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('11111111-1111');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('private-value');
  });

  it('logs endpoint and safe database diagnostics while keeping the client response generic', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const cause = Object.assign(new Error('password authentication failed for user "drezivo_app"'), { code: '28P01', detail: 'owner@example.com' });

    const res = handle(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is temporarily unavailable.', {
      cause,
      diagnostics: {
        dependency: 'tenant_admin_database', reason: 'authentication_failed',
        configurationKeys: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'],
      },
    }), { method: 'GET', path: '/subscription-payments' });

    expect(res.body).toEqual({ success: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Business administration is temporarily unavailable.' }, request_id: 'req-1' });
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(line).toMatchObject({
      event: 'api.request.failed', request_id: 'req-1', method: 'GET', route: '/api/v1/subscription-payments',
      status: 503, code: 'DEPENDENCY_UNAVAILABLE', dependency: 'tenant_admin_database', reason: 'authentication_failed',
      configuration_keys: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'], cause: { name: 'Error', code: '28P01' },
    });
    expect(JSON.stringify(line)).not.toContain('owner@example.com');
    expect(JSON.stringify(line)).not.toContain('password authentication');
    expect(JSON.stringify(line)).not.toContain('drezivo_app');
  });

  it('infers missing tenant database configuration from the route without logging URL or query values', () => {
    vi.stubEnv('OPERATOR_TENANT_ADMIN_DATABASE_URL', '');
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    handle(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is not configured.'), {
      method: 'GET', path: '/tenants/:tenantId',
    });

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'api.request.failed', route: '/api/v1/tenants/:tenantId', dependency: 'tenant_admin_database',
      reason: 'not_configured', configuration_keys: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'],
    }), 'API request failed');
  });

  it('logs safe database role flags, but not routine client errors or malformed JSON', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    handle(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    handle(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' }));
    expect(log).not.toHaveBeenCalled();

    handle(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The database role is invalid.', {
      diagnostics: {
        dependency: 'tenant_admin_database', reason: 'unsafe_role',
        configurationKeys: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'],
        databaseRole: { superuser: true, bypassRls: false },
      },
    }), { method: 'POST', path: '/tenants/:tenantId/trial' });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      route: '/api/v1/tenants/:tenantId/trial', reason: 'unsafe_role',
      database_role: { superuser: true, bypass_rls: false },
    }), 'API request failed');
  });

  it('logs unexpected errors with route templates and omits error messages', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const res = handle(new TypeError('provider token and owner@example.com?token=secret'), {
      method: 'POST', path: '/tenants/:tenantId/profile',
    });

    expect(res.statusCode).toBe(500);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'api.request.failed', request_id: 'req-1', method: 'POST', route: '/api/v1/tenants/:tenantId/profile',
      status: 500, error: { name: 'TypeError' },
    }), 'API request failed');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('owner@example.com');
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain('secret');
  });
});
