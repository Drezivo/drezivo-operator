import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireOperatorPermission, type OperatorPermissionResolver } from '../src/operator-permission.js';

const principal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_operator', roles: ['platform_owner' as const], requestId: 'req' };
function app(middleware: ReturnType<typeof requireOperatorPermission>, withPrincipal = true) {
  const server = express(); server.use((req, res, next) => { if (withPrincipal) res.locals.operatorPrincipal = principal; next(); });
  server.get('/protected', middleware, (_req, res) => res.status(204).end());
  server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const e = error as { status?: number; code?: string; message?: string }; res.status(e.status ?? 500).json({ error: { code: e.code, message: e.message } }); });
  return server;
}

describe('operator permission middleware', () => {
  it('allows an asynchronously resolved permission without exposing principal data', async () => {
    let seen: unknown; const resolver: OperatorPermissionResolver = async (input) => { seen = input; return true; };
    const response = await request(app(requireOperatorPermission('business.read', resolver))).get('/protected');
    expect(response.status).toBe(204); expect(seen).toMatchObject({ principal, permission: 'business.read' }); expect((seen as { request?: Request }).request).toBeDefined();
  });
  it('denies when the verified principal is missing or the resolver returns false', async () => {
    expect((await request(app(requireOperatorPermission('business.read'), false)).get('/protected')).body.error).toEqual({ code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' });
    expect((await request(app(requireOperatorPermission('business.read'))).get('/protected')).status).toBe(403);
  });
  it('maps resolver failures to a safe authorization-unavailable error', async () => {
    const response = await request(app(requireOperatorPermission('business.read', async () => { throw new Error('secret provider response'); }))).get('/protected');
    expect(response.status).toBe(503); expect(response.body.error).toEqual({ code: 'OPERATOR_AUTH_UNAVAILABLE', message: 'Operator authorization is temporarily unavailable.' }); expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('fails closed for malformed permission configuration without calling the resolver', async () => {
    let called = false; const resolver: OperatorPermissionResolver = async () => { called = true; return true; };
    const response = await request(app(requireOperatorPermission('bad permission' as never, resolver))).get('/protected');
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('FORBIDDEN'); expect(called).toBe(false);
  });
});
