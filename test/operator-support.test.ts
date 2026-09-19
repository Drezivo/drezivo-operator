import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOperatorSupportGrantRouter, type SupportGrantCommandPort } from '../src/operator-support/index.js';
import { AppError } from '../src/errors.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const grantId = '650e8400-e29b-41d4-a716-446655440000';
const projection = { grant_id: grantId, tenant_id: tenantId, operator_subject: 'user_operator', permission_codes: ['business.read'], starts_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z', revoked_at: null, created_at: '2026-01-01T00:00:00Z' };
const input = { tenant_id: tenantId, permission_codes: ['business.read'], reason: 'Investigate a reported billing issue', starts_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-02T00:00:00Z' };
function port(overrides: Partial<SupportGrantCommandPort> = {}): SupportGrantCommandPort { return { createSupportGrant: async () => projection, revokeSupportGrant: async () => ({ ...projection, revoked_at: '2026-01-01T12:00:00Z' }), ...overrides }; }
function app(commandPort: SupportGrantCommandPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next(), withPrincipal = true) { const a = express(); a.use(express.json()); a.use((_req, res, next) => { res.locals.requestId = 'req'; if (withPrincipal) res.locals.operatorPrincipal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_operator', requestId: 'req' }; next(); }); a.use('/api/v1', createOperatorSupportGrantRouter(commandPort, (_req, _res, next) => next(), { permissionMiddleware: permission })); a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => { const typed = e as { status?: number; code?: string; message?: string }; res.status(typed.status ?? 500).json({ error: { code: typed.code, message: typed.message } }); }); return a; }
const key = 'intent-key-123456';

describe('support grant command boundary', () => {
  it('validates input, derives the operator subject, forwards audit context, and returns a safe projection', async () => { let seen: unknown; const r = await request(app(port({ createSupportGrant: async (value) => { seen = value; return projection; } }))).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input); expect(r.status).toBe(201); expect(r.body.data).toEqual(projection); expect(seen).toEqual({ ...input, operatorSubject: 'user_operator', idempotencyKey: key, requestId: 'req' }); });
  it('requires a valid idempotency key and rejects invalid grant input before the port', async () => { let called = false; const p = port({ createSupportGrant: async () => { called = true; return projection; } }); expect((await request(app(p)).post('/api/v1/support-grants').send(input)).body.error.code).toBe('VALIDATION_FAILED'); expect((await request(app(p)).post('/api/v1/support-grants').set('Idempotency-Key', 'short').send(input)).body.error.code).toBe('VALIDATION_FAILED'); expect((await request(app(p)).post('/api/v1/support-grants').set('Idempotency-Key', key).send({ ...input, expires_at: input.starts_at })).body.error.code).toBe('VALIDATION_FAILED'); expect(called).toBe(false); });
  it('validates revoke identifiers, permission scopes, and provider response shapes', async () => { const seen: string[] = []; const r = await request(app(port({ revokeSupportGrant: async ({ grantId: id, operatorSubject, idempotencyKey, requestId }) => { seen.push(`${id}:${operatorSubject}:${idempotencyKey}:${requestId}`); return { ...projection, revoked_at: '2026-01-01T12:00:00Z' }; } }))).post(`/api/v1/support-grants/${grantId}/revoke`).set('Idempotency-Key', key); expect(r.status).toBe(200); expect(seen).toEqual([`${grantId}:user_operator:${key}:req`]); const malformed = port({ createSupportGrant: async () => ({ ...projection, tenant_id: 'secret' }) }); expect((await request(app(malformed)).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input)).status).toBe(503); expect((await request(app(port())).post('/api/v1/support-grants/not-uuid/revoke').set('Idempotency-Key', key)).body.error.code).toBe('VALIDATION_FAILED'); });
  it('rejects duplicate permission codes in create and revoke projections while accepting unique projections', async () => {
    const duplicate = { ...projection, permission_codes: ['business.read', 'business.read'] };
    const createResponse = await request(app(port({ createSupportGrant: async () => duplicate }))).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input);
    expect(createResponse.status).toBe(503);
    expect(createResponse.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    const revokeResponse = await request(app(port({ revokeSupportGrant: async () => ({ ...duplicate, revoked_at: '2026-01-01T12:00:00Z' }) }))).post(`/api/v1/support-grants/${grantId}/revoke`).set('Idempotency-Key', key);
    expect(revokeResponse.status).toBe(503);
    expect(revokeResponse.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    const uniqueResponse = await request(app(port())).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input);
    expect(uniqueResponse.status).toBe(201);
    expect(uniqueResponse.body.data.permission_codes).toEqual(['business.read']);
  });
  it('fails closed when command service is unavailable and enforces permissions', async () => { expect((await request(app({ createSupportGrant: async () => { throw new Error('down'); }, revokeSupportGrant: async () => { throw new Error('down'); } })).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input)).body.error.code).toBe('DEPENDENCY_UNAVAILABLE'); const seen: string[] = []; const denied = app(port(), (name) => { seen.push(name); return (_req, _res, next) => next(Object.assign(new Error(), { status: 403, code: 'FORBIDDEN', message: 'denied' })); }); expect((await request(denied).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input)).status).toBe(403); expect(seen).toEqual(['support.grant.create', 'support.grant.revoke']); });
  it('requires the verified operator context before calling the command port', async () => { let called = false; const p = port({ createSupportGrant: async () => { called = true; return projection; } }); const response = await request(app(p, undefined, false)).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input); expect(response.status).toBe(403); expect(called).toBe(false); });
  it('redacts provider AppError details while preserving local validation errors', async () => {
    const response = await request(app(port({ createSupportGrant: async () => { throw new AppError(500, 'SQL_ERROR', 'clerk secret and SQL details'); } }))).post('/api/v1/support-grants').set('Idempotency-Key', key).send(input);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', message: 'The business command service is unavailable.' });
    expect(JSON.stringify(response.body)).not.toContain('clerk secret and SQL details');
    const invalid = await request(app(port())).post('/api/v1/support-grants').set('Idempotency-Key', key).send({ ...input, expires_at: input.starts_at });
    expect(invalid.body.error).toEqual({ code: 'VALIDATION_FAILED', message: 'The support grant request is invalid.' });
  });
});
