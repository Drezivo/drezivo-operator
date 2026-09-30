import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { createOperatorTenantAdminRouter, type CommandContext, type ProofLinkSigner, type SubscriptionPaymentRow, type TenantAdminPort, type TenantDetail } from '../src/operator-tenant-admin/index.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const membershipId = '650e8400-e29b-41d4-a716-446655440000';
const paymentId = '750e8400-e29b-41d4-a716-446655440000';
const key = 'intent-key-1234567890';
const now = new Date('2026-10-01T00:00:00Z');
const detail: TenantDetail = {
  tenant_id: tenantId, name: 'Luna Gowns', slug: 'luna-gowns', status: 'active', timezone: 'Asia/Manila', created_at: '2026-09-20T00:00:00.000Z',
  subscription: { status: 'trialing', plan_code: 'starter', trial_ends_at: '2026-10-04T00:00:00.000Z', grace_ends_at: null, current_period_end: '2026-10-04T00:00:00.000Z' },
  member_counts: { active: 1, suspended: 0, removed: 0 }, pending_payment: false, members: [], recent_audit: [], notes: [], payments: [],
};
const result = { tenant: detail, changed: true, replayed: false };

function port(overrides: Partial<TenantAdminPort> = {}): TenantAdminPort {
  return {
    listTenants: async () => [detail], listPeople: async () => [], getTenant: async () => detail, updateProfile: async () => result, setTenantLocked: async () => result,
    setMemberSuspended: async () => result, setTrialEnd: async () => result, activateSubscription: async () => result,
    extendReadOnly: async () => result, addNote: async () => result, listPayments: async () => [], reviewPayment: async () => result, ...overrides,
  };
}
const directory = { lookup: async (ids: readonly string[]) => new Map(ids.filter((id) => id === 'user_owner_a').map((id) => [id, { email: 'owner@luna.ph', name: 'Luna Owner', last_sign_in_at: null, banned: false, locked: false }] as const)) };
function app(p: TenantAdminPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next(), withPrincipal = true, proofLink?: ProofLinkSigner) {
  const a = express();
  a.use(express.json());
  a.use((_req, res, next) => {
    res.locals.requestId = 'req';
    if (withPrincipal) res.locals.operatorPrincipal = { clerkUserId: 'user_operator', operatorOrganizationId: 'org_op', roles: ['platform_owner'], requestId: 'req' };
    next();
  });
  a.use('/api/v1', createOperatorTenantAdminRouter(p, (_req, _res, next) => next(), { permissionMiddleware: permission, now: () => now, directory, proofLink }));
  a.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const typed = e as { status?: number; code?: string; message?: string };
    res.status(typed.status ?? 500).json({ error: { code: typed.code, message: typed.message } });
  });
  return a;
}

describe('operator tenant administration boundary', () => {
  it('lists and reads businesses under the read permission', async () => {
    const seen: string[] = [];
    const a = app(port(), (name) => { seen.push(name); return (_req, _res, next) => next(); });
    const list = await request(a).get('/api/v1/tenants');
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].tenant_id).toBe(tenantId);
    expect(list.headers['cache-control']).toBe('no-store');
    expect((await request(a).get(`/api/v1/tenants/${tenantId}`)).body.data.name).toBe('Luna Gowns');
    expect(seen).toContain('tenant.admin.read');
    expect(seen).toContain('tenant.admin.manage');
  });

  it('lists people across businesses and adds names and emails from the business directory', async () => {
    const people = [
      { tenant_id: tenantId, tenant_name: 'Luna Gowns', tenant_status: 'active' as const, membership_id: membershipId, clerk_user_id: 'user_owner_a', role: 'owner' as const, status: 'active' as const, created_at: '2026-09-20T00:00:00.000Z' },
      { tenant_id: tenantId, tenant_name: 'Luna Gowns', tenant_status: 'active' as const, membership_id: membershipId, clerk_user_id: 'user_unknown', role: 'frontdesk' as const, status: 'active' as const, created_at: '2026-09-20T00:00:00.000Z' },
    ];
    const r = await request(app(port({ listPeople: async () => people }))).get('/api/v1/people');
    expect(r.status).toBe(200);
    expect(r.body.data.items[0].profile.email).toBe('owner@luna.ph');
    expect(r.body.data.items[1].profile).toBeNull();
    const withMember = { ...detail, members: [{ membership_id: membershipId, clerk_user_id: 'user_owner_a', role: 'owner' as const, status: 'active' as const, created_at: '2026-09-20T00:00:00.000Z' }] };
    const d = await request(app(port({ getTenant: async () => withMember }))).get(`/api/v1/tenants/${tenantId}`);
    expect(d.body.data.members[0].profile.name).toBe('Luna Owner');
    const c = await request(app(port({ setTenantLocked: async () => ({ ...result, tenant: withMember }) }))).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', key).send({ reason: 'Unpaid invoice' });
    expect(c.body.data.tenant.members[0].profile.email).toBe('owner@luna.ph');
  });

  it('returns 404 for an unknown business and 400 for a malformed identifier', async () => {
    const a = app(port({ getTenant: async () => null }));
    expect((await request(a).get(`/api/v1/tenants/${tenantId}`)).status).toBe(404);
    expect((await request(a).get('/api/v1/tenants/not-a-uuid')).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('forwards operator subject, idempotency key, request id and reason to every command', async () => {
    const calls: Array<{ name: string; ctx: CommandContext }> = [];
    const record = (name: string) => async (..._args: unknown[]) => { calls.push({ name, ctx: _args.at(-1) as CommandContext }); return result; };
    const a = app(port({
      updateProfile: record('profile'), setTenantLocked: record('lock'), setMemberSuspended: record('member'),
      setTrialEnd: record('trial'), activateSubscription: record('activate'),
    }));
    const send = (path: string, body: object) => request(a).post(`/api/v1/tenants/${tenantId}${path}`).set('Idempotency-Key', key).send(body);
    expect((await send('/profile', { name: 'Luna Gown Rentals', reason: 'Owner asked for rename' })).status).toBe(200);
    expect((await send('/lock', { reason: 'Unpaid invoice' })).status).toBe(200);
    expect((await send('/unlock', { reason: 'Payment received' })).status).toBe(200);
    expect((await send(`/members/${membershipId}/suspend`, { reason: 'Staff left the shop' })).status).toBe(200);
    expect((await send(`/members/${membershipId}/reactivate`, { reason: 'Rehired' })).status).toBe(200);
    expect((await send('/trial', { trial_ends_at: '2026-10-20T00:00:00Z', reason: 'Pilot extension' })).status).toBe(200);
    expect((await send('/activate', { current_period_end: '2026-11-01T00:00:00Z', reason: 'GCash payment verified' })).status).toBe(200);
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.ctx).toMatchObject({ operatorSubject: 'user_operator', idempotencyKey: key, requestId: 'req' });
      expect(call.ctx.reason.length).toBeGreaterThan(2);
    }
  });

  it('rejects commands without a valid idempotency key, reason, or bounded date before calling the port', async () => {
    let called = false;
    const p = port({ setTenantLocked: async () => { called = true; return result; }, setTrialEnd: async () => { called = true; return result; }, activateSubscription: async () => { called = true; return result; } });
    const a = app(p);
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/lock`).send({ reason: 'Unpaid invoice' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', 'short').send({ reason: 'Unpaid' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', key).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', key).send({ reason: 'ok reason', extra: true })).body.error.code).toBe('VALIDATION_FAILED');
    const past = await request(a).post(`/api/v1/tenants/${tenantId}/trial`).set('Idempotency-Key', key).send({ trial_ends_at: '2026-09-01T00:00:00Z', reason: 'extend' });
    expect(past.body.error.code).toBe('VALIDATION_FAILED');
    const tooFar = await request(a).post(`/api/v1/tenants/${tenantId}/trial`).set('Idempotency-Key', key).send({ trial_ends_at: '2027-06-01T00:00:00Z', reason: 'extend' });
    expect(tooFar.body.error.message).toContain('90 days');
    const periodTooFar = await request(a).post(`/api/v1/tenants/${tenantId}/activate`).set('Idempotency-Key', key).send({ current_period_end: '2028-01-01T00:00:00Z', reason: 'paid' });
    expect(periodTooFar.body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/profile`).set('Idempotency-Key', key).send({ reason: 'nothing to change' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(a).post(`/api/v1/tenants/${tenantId}/profile`).set('Idempotency-Key', key).send({ timezone: 'Mars/Olympus', reason: 'bad zone' })).body.error.code).toBe('VALIDATION_FAILED');
    expect(called).toBe(false);
  });

  it('requires a verified operator and the manage permission for commands', async () => {
    let called = false;
    const p = port({ setTenantLocked: async () => { called = true; return result; } });
    expect((await request(app(p, undefined, false)).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', key).send({ reason: 'Unpaid invoice' })).status).toBe(403);
    const denyManage = (name: string) => (_req: Request, _res: Response, next: NextFunction) =>
      next(name === 'tenant.admin.manage' ? new AppError(403, 'FORBIDDEN', 'denied') : undefined);
    const readOnly = app(p, denyManage);
    expect((await request(readOnly).get('/api/v1/tenants')).status).toBe(200);
    expect((await request(readOnly).post(`/api/v1/tenants/${tenantId}/lock`).set('Idempotency-Key', key).send({ reason: 'Unpaid invoice' })).status).toBe(403);
    expect(called).toBe(false);
  });

  it('passes safe state conflicts through and redacts unexpected dependency errors', async () => {
    const conflict = app(port({ setTenantLocked: async () => { throw new AppError(409, 'STATE_CONFLICT', 'The subscription is restricted.'); } }));
    const r = await request(conflict).post(`/api/v1/tenants/${tenantId}/unlock`).set('Idempotency-Key', key).send({ reason: 'Payment received' });
    expect(r.status).toBe(409);
    const leaking = app(port({ listTenants: async () => { throw new Error('password authentication failed for user drezivo_app at db.example'); } }));
    const down = await request(leaking).get('/api/v1/tenants');
    expect(down.status).toBe(503);
    expect(JSON.stringify(down.body)).not.toContain('password');
  });

  it('forwards pilot billing commands with their ids, and uses the operator as the note author', async () => {
    const calls: unknown[][] = [];
    const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return result; };
    const a = app(port({ extendReadOnly: record('extend'), addNote: record('note'), reviewPayment: record('review') }));
    const send = (path: string, body: object) => request(a).post(`/api/v1/tenants/${tenantId}${path}`).set('Idempotency-Key', key).send(body);
    expect((await send('/read-only-extension', { read_only_until: '2026-10-15T00:00:00Z', reason: 'Owner paying next week' })).status).toBe(200);
    expect((await send('/notes', { body: 'Called the owner about GCash.' })).status).toBe(200);
    expect((await send(`/subscription-payments/${paymentId}/approve`, { reason: 'Reference matched' })).status).toBe(200);
    expect((await send(`/subscription-payments/${paymentId}/reject`, { reason: 'Amount was 200, not 300' })).status).toBe(200);

    expect(calls[0]).toEqual(['extend', tenantId, new Date('2026-10-15T00:00:00Z'), expect.objectContaining({ reason: 'Owner paying next week' })]);
    expect(calls[1]).toEqual(['note', tenantId, 'Called the owner about GCash.', 'user_operator', expect.objectContaining({ idempotencyKey: key })]);
    expect(calls[2]).toEqual(['review', tenantId, paymentId, 'approve', expect.objectContaining({ reason: 'Reference matched' })]);
    expect(calls[3]).toEqual(['review', tenantId, paymentId, 'reject', expect.objectContaining({ reason: 'Amount was 200, not 300' })]);
  });

  it('validates pilot billing input before calling the port', async () => {
    let called = false;
    const touch = async () => { called = true; return result; };
    const a = app(port({ extendReadOnly: touch, addNote: touch, reviewPayment: touch }));
    const send = (path: string, body: object) => request(a).post(`/api/v1/tenants/${tenantId}${path}`).set('Idempotency-Key', key).send(body);
    expect((await send('/read-only-extension', { read_only_until: '2026-09-01T00:00:00Z', reason: 'too late' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await send('/notes', { body: '   ' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await send('/notes', { body: 'x'.repeat(2001) })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await send('/subscription-payments/not-a-uuid/approve', { reason: 'Reference matched' })).body.error.code).toBe('VALIDATION_FAILED');
    expect((await send(`/subscription-payments/${paymentId}/reject`, {})).body.error.message).toContain('owner sees this');
    expect((await request(a).get('/api/v1/subscription-payments?status=everything')).body.error.code).toBe('VALIDATION_FAILED');
    expect(called).toBe(false);
  });

  it('lists the payment queue, defaulting to pending', async () => {
    const filters: string[] = [];
    const row: SubscriptionPaymentRow = {
      payment_id: paymentId, tenant_id: tenantId, tenant_name: 'Luna Gowns', status: 'pending', amount_minor: '30000', currency: 'PHP',
      reference: 'GC-123', method_label: 'GCash', submitted_at: '2026-10-01T00:00:00.000Z', reviewed_at: null, reviewed_by: null, review_note: null, has_proof: true,
    };
    const a = app(port({ listPayments: async (filter) => { filters.push(filter); return [row]; } }));
    const pending = await request(a).get('/api/v1/subscription-payments');
    expect(pending.status).toBe(200);
    expect(pending.body.data.items[0].reference).toBe('GC-123');
    expect(pending.headers['cache-control']).toBe('no-store');
    await request(a).get('/api/v1/subscription-payments?status=recent');
    expect(filters).toEqual(['pending', 'recent']);
  });

  it('signs a proof link only when proof viewing is configured', async () => {
    const off = await request(app(port())).get(`/api/v1/tenants/${tenantId}/subscription-payments/${paymentId}/proof-link`);
    expect(off.status).toBe(503);
    const signed: string[] = [];
    const signer: ProofLinkSigner = (t, p) => { signed.push(`${t}/${p}`); return { url: 'https://api.example/proof/p1.token', expires_at: '2026-10-01T00:05:00.000Z' }; };
    const on = await request(app(port(), undefined, true, signer)).get(`/api/v1/tenants/${tenantId}/subscription-payments/${paymentId}/proof-link`);
    expect(on.status).toBe(200);
    expect(on.body.data.url).toBe('https://api.example/proof/p1.token');
    expect(signed).toEqual([`${tenantId}/${paymentId}`]);
  });
});
