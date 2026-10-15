import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceRouter, type WorkspacePort } from './index.js';
import { requestId, errorHandler } from '../middleware.js';
import type { OperatorRole } from '../operator-authorization.js';
import { AppError } from '../errors.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const grant = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const base = `/api/v1/tenants/${tenant}/workspace`;
function fixture(role: OperatorRole = 'platform_owner', allowed = true) {
  const execute = vi.fn<WorkspacePort['execute']>(async ({ operation }) => {
    if (operation === 'open' || operation === 'status') return { grant_id: grant, tenant_id: tenant, mode: 'repair', operator_subject: 'user_verified', expires_at: '2026-10-15T12:00:00Z' };
    if (operation === 'close') return { grant_id: grant, closed: true };
    if (operation === 'correct') return { id: item, corrected: true };
    if (operation === 'delete') return { id: item, deleted: true, variants: 1, assets: 1, images: 0 };
    return { resource: 'clothing', columns: ['id'], editable: ['name'], deletable: true, items: [], next_cursor: null };
  });
  const app = express(); app.use(requestId, express.json());
  app.use('/api/v1', createWorkspaceRouter({ execute }, (_req, res, next) => { res.locals.operatorPrincipal = { clerkUserId: 'user_verified', roles: [role], operatorOrganizationId: 'org_local', requestId: String(res.locals.requestId) }; next(); }, () => (_req, _res, next) => next(allowed ? undefined : new AppError(403, 'FORBIDDEN', 'Denied.'))));
  app.use(errorHandler); return { app, execute };
}
describe('workspace HTTP boundary', () => {
  it('derives identity on the server and rejects caller identity, scope and unknown access mode', async () => {
    const { app, execute } = fixture();
    const body = { mode: 'repair', minutes: 30, reason: 'Fix synthetic encoding' };
    expect((await request(app).post(base).set('Idempotency-Key', 'local-intent-workspace-open').send(body)).status).toBe(201);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ subject: 'user_verified', tenantId: tenant, operation: 'open' });
    for (const extra of [{ subject: 'user_other' }, { permission_codes: ['everything'] }, { mode: 'everything' }]) expect((await request(app).post(base).set('Idempotency-Key', 'local-intent-workspace-open').send({ ...body, ...extra })).status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('requires a Superadmin and server permission for every workspace route', async () => {
    for (const [role, allowed] of [['support_operator', true], ['platform_owner', false]] as const) {
      const { app, execute } = fixture(role, allowed);
      expect((await request(app).get(`${base}/${grant}/records/clothing`)).status).toBe(403);
      expect((await request(app).post(base).send({})).status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('rejects unknown resources and query fields without reaching the database', async () => {
    const { app, execute } = fixture();
    for (const path of [`${base}/${grant}/records/audit_event`, `${base}/${grant}/records/clothing?tenant_id=${tenant}`, `${base}/${grant}/records/clothing?after=not-a-cursor`]) expect((await request(app).get(path)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects immutable fields, empty patches, invalid values and missing intent keys', async () => {
    const { app, execute } = fixture(); const path = `${base}/${grant}/records/clothing/${item}/correct`;
    const body = { fingerprint: 'a'.repeat(64), reason: 'Correct synthetic clothing', changes: { name: 'Correct name' } };
    for (const changes of [{ tenant_id: tenant }, {}, { name: '' }, { name: 'a'.repeat(201) }, { rental_price_minor: -10 }]) expect((await request(app).post(path).set('Idempotency-Key', 'local-intent-correction').send({ ...body, changes })).status).toBe(400);
    expect((await request(app).post(path).send(body)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('validates destructive confirmation and forwards the same intent for repeated requests', async () => {
    const { app, execute } = fixture(); const path = `${base}/${grant}/clothing/${item}/delete`;
    const body = { fingerprint: 'a'.repeat(64), reason: 'Remove synthetic mistake', confirm_id: item, confirm_name: 'Synthetic item', acknowledge: 'PERMANENTLY DELETE' };
    for (const extra of [{ confirm_id: tenant }, { acknowledge: 'archive' }, { cascade: true }]) expect((await request(app).post(path).set('Idempotency-Key', 'local-intent-deletion').send({ ...body, ...extra })).status).toBe(400);
    const send = () => request(app).post(path).set('Idempotency-Key', 'local-intent-deletion').send(body);
    expect((await send()).status).toBe(200); expect((await send()).status).toBe(200);
    expect((await Promise.all([send(), send()])).map(r => r.status)).toEqual([200, 200]);
    expect(execute.mock.calls.every(([input]) => input.idempotencyKey === 'local-intent-deletion' && input.subject === 'user_verified')).toBe(true);
  });
  it('resumes a grant only through the authenticated, scoped read boundary', async () => {
    const { app, execute } = fixture();
    const response = await request(app).get(`${base}/${grant}`);
    expect(response.status).toBe(200); expect(response.body.data).toMatchObject({grant_id:grant,tenant_id:tenant,operator_subject:'user_verified'});
    expect(execute.mock.calls[0]?.[0]).toMatchObject({operation:'status',subject:'user_verified',tenantId:tenant,grantId:grant});
    expect((await request(app).get(`${base}/${grant}?subject=forged`)).status).toBe(400);
  });
  it('requires close to have an empty body and a valid intent key', async () => {
    const { app, execute } = fixture(); const path = `${base}/${grant}/close`;
    expect((await request(app).post(path).send({})).status).toBe(400);
    expect((await request(app).post(path).set('Idempotency-Key', 'local-intent-close').send({ operator: 'user_other' })).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
