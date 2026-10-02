import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOperatorRetryRouter, type OperationsRetryCommandPort } from '../src/operator-retry/index.js';
import { AppError } from '../src/errors.js';

const jobId = '550e8400-e29b-41d4-a716-446655440000';
const deliveryId = '650e8400-e29b-41d4-a716-446655440000';
const result = (kind: 'job.retry' | 'notification.retry', id: string) => ({ command_kind: kind, resource_id: id, status: 'accepted' as const, request_id: 'req', accepted_at: '2026-01-01T00:00:00Z' });
const key = 'retry-intent-123456';
const reason = { reason: 'Retry after the provider timeout was investigated.' };
function port(overrides: Partial<OperationsRetryCommandPort> = {}): OperationsRetryCommandPort { return { retryJob: async () => result('job.retry', jobId), retryNotification: async () => result('notification.retry', deliveryId), ...overrides }; }
function app(commandPort: OperationsRetryCommandPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next(), withPrincipal = true) {
  const a = express(); a.use(express.json()); a.use((_req, res, next) => { res.locals.requestId = 'req'; if (withPrincipal) res.locals.operatorPrincipal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_operator', roles: ['platform_owner'], requestId: 'req' }; next(); });
  a.use('/api/v1', createOperatorRetryRouter(commandPort, (_req, _res, next) => next(), { permissionMiddleware: permission }));
  a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => { const typed = e as { status?: number; code?: string; message?: string }; res.status(typed.status ?? 500).json({ error: { code: typed.code, message: typed.message } }); }); return a;
}

describe('operations retry command boundary', () => {
  it('forwards verified context and returns a safe accepted job result', async () => {
    let seen: unknown; const response = await request(app(port({ retryJob: async (input) => { seen = input; return result('job.retry', jobId); } }))).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send(reason);
    expect(response.status).toBe(202); expect(response.body.data).toEqual(result('job.retry', jobId)); expect(seen).toEqual({ ...reason, jobId, operatorSubject: 'user_operator', idempotencyKey: key, requestId: 'req' });
  });
  it('supports notification retry with the same boundary', async () => { const response = await request(app(port())).post(`/api/v1/notifications/${deliveryId}/retry`).set('Idempotency-Key', key).send(reason); expect(response.status).toBe(202); expect(response.body.data).toEqual(result('notification.retry', deliveryId)); });
  it('validates body, UUID paths, and idempotency keys before invoking the port', async () => {
    let called = false; const p = port({ retryJob: async () => { called = true; return result('job.retry', jobId); } });
    expect((await request(app(p)).post('/api/v1/jobs/not-uuid/retry').set('Idempotency-Key', key).send(reason)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app(p)).post(`/api/v1/jobs/${jobId}/retry`).send(reason)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app(p)).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', 'short').send(reason)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app(p)).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send({ reason: '' })).body.error.code).toBe('VALIDATION_FAILED'); expect(called).toBe(false);
  });
  it('checks permission before input validation and uses distinct scopes', async () => { const seen: string[] = []; const denied = app(port(), (name) => { seen.push(name); return (_req, _res, next) => next(Object.assign(new Error(), { status: 403, code: 'FORBIDDEN', message: 'denied' })); }); expect((await request(denied).post(`/api/v1/jobs/${jobId}/retry`).send({})).status).toBe(403); expect((await request(denied).post(`/api/v1/notifications/${deliveryId}/retry`).send({})).status).toBe(403); expect(seen).toEqual(['job.retry', 'notification.retry']); });
  it('fails closed for missing operator, unavailable service, and malformed provider responses', async () => {
    expect((await request(app(port(), undefined, false)).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send(reason)).status).toBe(403);
    expect((await request(app({ retryJob: async () => { throw new Error('secret provider token'); }, retryNotification: async () => { throw new Error('down'); } })).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send(reason)).body.error).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', message: 'The business command service is unavailable.' });
    const malformed = port({ retryNotification: async () => ({ ...result('notification.retry', deliveryId), provider_token: 'secret' } as never) }); const response = await request(app(malformed)).post(`/api/v1/notifications/${deliveryId}/retry`).set('Idempotency-Key', key).send(reason); expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('redacts provider AppError details while preserving local validation errors', async () => {
    const response = await request(app(port({ retryJob: async () => { throw new AppError(500, 'SQL_ERROR', 'postgres password secret'); } }))).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send(reason);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', message: 'The business command service is unavailable.' });
    expect(JSON.stringify(response.body)).not.toContain('postgres password secret');
    const invalid = await request(app(port())).post(`/api/v1/jobs/${jobId}/retry`).set('Idempotency-Key', key).send({ reason: '' });
    expect(invalid.body.error).toEqual({ code: 'VALIDATION_FAILED', message: 'The retry request is invalid.' });
  });
});
