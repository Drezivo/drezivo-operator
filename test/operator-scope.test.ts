import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireOperatorTenantScope, tenantIdFromPath, type TenantScopeResolver } from '../src/operator-scope.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const principal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_operator', requestId: 'req' };
function app(middleware: ReturnType<typeof requireOperatorTenantScope>, withPrincipal = true) {
  const server = express(); server.use((_req, res, next) => { if (withPrincipal) res.locals.operatorPrincipal = principal; next(); });
  server.get('/tenants/:tenantId/protected', middleware, (_req, res) => res.status(204).end());
  server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const e = error as { status?: number; code?: string; message?: string }; res.status(e.status ?? 500).json({ error: { code: e.code, message: e.message } }); }); return server;
}

describe('operator tenant scope middleware', () => {
  it('approves an asynchronously resolved tenant scope and forwards the verified context', async () => {
    let seen: unknown; const resolver: TenantScopeResolver = async (input) => { seen = input; return true; };
    const response = await request(app(requireOperatorTenantScope(tenantIdFromPath(), resolver))).get(`/tenants/${tenantId}/protected`);
    expect(response.status).toBe(204); expect(seen).toMatchObject({ principal, tenantId });
  });
  it('denies by default, when the principal is missing, and for malformed tenant IDs', async () => {
    expect((await request(app(requireOperatorTenantScope(tenantIdFromPath()))).get(`/tenants/${tenantId}/protected`)).status).toBe(403);
    expect((await request(app(requireOperatorTenantScope(tenantIdFromPath()), false)).get(`/tenants/${tenantId}/protected`)).body.error.code).toBe('FORBIDDEN');
    expect((await request(app(requireOperatorTenantScope(tenantIdFromPath()))).get('/tenants/not-a-uuid/protected')).body.error).toEqual({ code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' });
  });
  it('denies an out-of-scope tenant and rejects an unsafe parameter configuration', async () => {
    const resolver: TenantScopeResolver = async () => false;
    expect((await request(app(requireOperatorTenantScope(tenantIdFromPath(), resolver))).get(`/tenants/${tenantId}/protected`)).status).toBe(403);
    expect((await request(app(requireOperatorTenantScope(tenantIdFromPath('tenant-id')))).get(`/tenants/${tenantId}/protected`)).status).toBe(403);
  });
  it('maps resolver failures to a safe authorization-unavailable error', async () => {
    const response = await request(app(requireOperatorTenantScope(tenantIdFromPath(), async () => { throw new Error('private scope details'); }))).get(`/tenants/${tenantId}/protected`);
    expect(response.status).toBe(503); expect(response.body.error).toEqual({ code: 'OPERATOR_AUTH_UNAVAILABLE', message: 'Operator authorization is temporarily unavailable.' }); expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
