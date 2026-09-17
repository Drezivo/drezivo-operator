import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOperatorDirectoryRouter, encodeOperatorDirectoryCursor, type OperatorDirectoryItem, type OperatorDirectoryPort } from '../src/operator-directory/index.js';

const operatorId = 'op_01J00000000000000000000000';
const item: OperatorDirectoryItem = { operator_id: operatorId, display_name: 'Operations staff', role: 'support_operator', status: 'active', last_activity_at: '2026-01-01T00:00:00Z', assigned_tenant_count: 2 };
function app(port: OperatorDirectoryPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next()) {
  const a = express(); a.use((_req, res, next) => { res.locals.requestId = 'req'; next(); });
  a.use('/api/v1', createOperatorDirectoryRouter(port, (_req, _res, next) => next(), { permissionMiddleware: permission }));
  a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => { const x = e as { status?: number; code?: string; message?: string }; res.status(x.status ?? 500).json({ error: { code: x.code, message: x.message } }); }); return a;
}
function port(overrides: Partial<OperatorDirectoryPort> = {}): OperatorDirectoryPort { return { listOperators: async () => ({ items: [item], next_cursor: null }), ...overrides }; }

describe('operator directory read route', () => {
  it('returns safe directory records, no-store, and the required permission', async () => {
    const seen: string[] = [];
    const r = await request(app(port(), (name) => { seen.push(name); return (_req, _res, next) => next(); })).get('/api/v1/operators?role=support_operator&status=active');
    expect(r.status).toBe(200); expect(r.body.data.items).toEqual([item]); expect(r.headers['cache-control']).toBe('no-store'); expect(seen).toEqual(['operator.directory.read']);
  });
  it('rejects unknown, repeated, unsafe, and invalid filters', async () => {
    const r = request(app(port()));
    expect((await r.get('/api/v1/operators?unknown=x')).status).toBe(400);
    expect((await r.get('/api/v1/operators?role=administrator')).status).toBe(400);
    expect((await r.get('/api/v1/operators?status=active&status=suspended')).status).toBe(400);
    expect((await r.get('/api/v1/operators?limit=101')).status).toBe(400);
  });
  it('binds cursors to filters and rejects malformed or future cursors', async () => {
    const r = request(app(port()));
    const cursor = encodeOperatorDirectoryCursor({ lastActivityAt: item.last_activity_at, operatorId: operatorId }, { role: 'support_operator' });
    expect((await r.get(`/api/v1/operators?role=billing_operator&cursor=${cursor}`)).status).toBe(400);
    expect((await r.get('/api/v1/operators?cursor=not-a-cursor')).status).toBe(400);
    const future = Buffer.from(JSON.stringify({ v: 1, last_activity_at: '2999-01-01T00:00:00Z', operator_id: operatorId, filter_hash: 'bad' })).toString('base64url');
    expect((await r.get(`/api/v1/operators?cursor=${future}`)).status).toBe(400);
  });
  it('rejects malformed and future provider data, and hides dependency failures', async () => {
    const malformed = port({ listOperators: async () => ({ items: [{ ...item, role: 'unknown' } as never], next_cursor: null }) });
    expect((await request(app(malformed)).get('/api/v1/operators')).status).toBe(503);
    const future = port({ listOperators: async () => ({ items: [{ ...item, last_activity_at: '2999-01-01T00:00:00Z' }], next_cursor: null }) });
    expect((await request(app(future)).get('/api/v1/operators')).status).toBe(503);
    const down = port({ listOperators: async () => { throw new Error('secret'); } });
    const response = await request(app(down)).get('/api/v1/operators'); expect(response.status).toBe(503); expect(response.body.error.code).toBe('DEPENDENCY_UNAVAILABLE'); expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('denies access when the permission hook rejects', async () => {
    const response = await request(app(port(), () => (_req, _res, next) => next(Object.assign(new Error('denied'), { status: 403, code: 'FORBIDDEN', message: 'forbidden' })))).get('/api/v1/operators');
    expect(response.status).toBe(403);
  });
  it('fails closed when the default provider is unavailable', async () => {
    expect((await request(app(port({ listOperators: async () => { throw new Error('down'); } }))).get('/api/v1/operators')).status).toBe(503);
  });
});
