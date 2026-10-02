import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantAdminDbAdapter } from '../src/integrations/tenant-admin-db/index.js';
import { createPlatformPaymentsDbAdapter } from '../src/integrations/platform-payments-db/index.js';
import type { CommandContext } from '../src/operator-tenant-admin/index.js';

/**
 * Runs the operator tenant-admin adapter against the real business schema.
 *
 * Opt-in: set TENANT_ADMIN_IT_MIGRATIONS_DIR to a folder holding the business repository's
 * numbered SQL migrations (for example `git archive origin/main api/src/db/migrations`), and
 * optionally TENANT_ADMIN_IT_DATA_ROOT for where the throwaway Postgres 17 cluster is created.
 * The adapter connects as `drezivo_app` exactly as it would in production, so RLS applies.
 */
const migrationsDir = process.env.TENANT_ADMIN_IT_MIGRATIONS_DIR;
const PORT = 55_611;

describe.skipIf(!migrationsDir)('tenant admin adapter against the business schema', () => {
  let server: EmbeddedPostgres;
  let admin: pg.Client;
  let adapter: ReturnType<typeof createTenantAdminDbAdapter>;
  let platform: ReturnType<typeof createPlatformPaymentsDbAdapter>;
  let planId: string;
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const memberA = '33333333-3333-4333-8333-333333333333';
  let keySeq = 0;
  const ctx = (reason = 'integration test'): CommandContext => ({
    operatorSubject: 'user_operator', idempotencyKey: `it-key-${Date.now()}-${keySeq++}`, requestId: 'req-it', reason,
  });
  const count = async (sql: string, params: unknown[] = []) => Number((await admin.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

  beforeAll(async () => {
    const root = process.env.TENANT_ADMIN_IT_DATA_ROOT ?? join(process.cwd(), '.it-data');
    server = new EmbeddedPostgres({ databaseDir: mkdtempSync(join(root, 'pg-')), user: 'postgres', password: 'it-super', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
    await server.initialise();
    await server.start();
    await server.createDatabase('drezivo');
    admin = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'it-super', database: 'drezivo' });
    await admin.connect();
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    // Same ledger as the business migrate script; business migration 0065 locks it down.
    await admin.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of readdirSync(migrationsDir!).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await admin.query('BEGIN');
      await admin.query(readFileSync(join(migrationsDir!, file), 'utf8'));
      await admin.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await admin.query('COMMIT');
    }
    await admin.query("ALTER ROLE drezivo_app WITH LOGIN PASSWORD 'it-app'");
    // Standard (code `starter`) is the only active plan since business migration 0063.
    const plan = await admin.query<{ id: string }>("SELECT id FROM plan WHERE code = 'starter' AND version = 1");
    const seededPlan = plan.rows[0]?.id;
    if (!seededPlan) throw new Error('The business migrations did not seed the Standard plan.');
    planId = seededPlan;
    for (const [id, slug] of [[tenantA, 'luna-gowns'], [tenantB, 'barong-hub']] as const) {
      await admin.query('INSERT INTO tenant (id, clerk_org_id, name, slug) VALUES ($1, $2, $3, $4)', [id, `org_${slug}`, slug, slug]);
      await admin.query(
        `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
         VALUES ($1, $2, 'trialing', now() + interval '3 days', now(), now() + interval '3 days')`,
        [id, planId],
      );
    }
    await admin.query("INSERT INTO membership (id, tenant_id, clerk_user_id, role) VALUES ($1, $2, 'user_owner_a', 'owner')", [memberA, tenantA]);
    await admin.query("INSERT INTO membership (tenant_id, clerk_user_id, role) VALUES ($1, 'user_owner_b', 'owner')", [tenantB]);
    adapter = createTenantAdminDbAdapter({ connectionString: `postgres://drezivo_app:it-app@localhost:${PORT}/drezivo` });
    platform = createPlatformPaymentsDbAdapter({ connectionString: `postgres://drezivo_app:it-app@localhost:${PORT}/drezivo` });
  }, 180_000);

  afterAll(async () => {
    await adapter?.close();
    await platform?.close();
    await admin?.end();
    await server?.stop();
  });

  it('lists every business with its subscription and member counts, and scopes detail to one tenant', async () => {
    const list = await adapter.listTenants();
    expect(list.map((t) => t.slug).sort()).toEqual(['barong-hub', 'luna-gowns']);
    expect(list.every((t) => t.subscription?.status === 'trialing')).toBe(true);
    const detail = await adapter.getTenant(tenantA);
    expect(detail?.members.map((m) => m.clerk_user_id)).toEqual(['user_owner_a']);
    expect(await adapter.getTenant('99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('lists people across every business under RLS', async () => {
    const people = await adapter.listPeople();
    expect(people.map((p) => `${p.tenant_name}:${p.clerk_user_id}:${p.role}`).sort()).toEqual(['barong-hub:user_owner_b:owner', 'luna-gowns:user_owner_a:owner']);
  });

  it('lock is duplicate-safe: a sequential retry with the same key replays without a second audit row', async () => {
    const context = ctx('Unpaid invoice');
    const first = await adapter.setTenantLocked(tenantA, true, context);
    const second = await adapter.setTenantLocked(tenantA, true, context);
    expect(first).toMatchObject({ changed: true, replayed: false });
    expect(second).toMatchObject({ changed: false, replayed: true });
    expect(second.tenant.status).toBe('restricted');
    expect(await count("SELECT count(*) n FROM operator_command WHERE intent_key = $1", [context.idempotencyKey])).toBe(1);
    expect(await count("SELECT count(*) n FROM audit_event WHERE tenant_id = $1 AND action = 'operator.tenant.lock'", [tenantA])).toBe(1);
  });

  it('unlock is duplicate-safe under concurrent double-fire: exactly one request applies', async () => {
    const context = ctx('Payment received');
    const results = await Promise.all(Array.from({ length: 5 }, () => adapter.setTenantLocked(tenantA, false, context)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(results.every((r) => r.tenant.status === 'active')).toBe(true);
    expect(await count("SELECT count(*) n FROM audit_event WHERE tenant_id = $1 AND action = 'operator.tenant.unlock'", [tenantA])).toBe(1);
  });

  it('a new intent on an already-applied state is recorded but changes nothing', async () => {
    const result = await adapter.setTenantLocked(tenantA, false, ctx('Second unlock click'));
    expect(result).toMatchObject({ changed: false, replayed: false });
  });

  it('member suspension bumps authz_version exactly once under concurrent double-fire', async () => {
    const before = await count('SELECT authz_version n FROM membership WHERE id = $1', [memberA]);
    const context = ctx('Staff member left');
    await Promise.all(Array.from({ length: 4 }, () => adapter.setMemberSuspended(tenantA, memberA, true, context)));
    expect(await count('SELECT authz_version n FROM membership WHERE id = $1', [memberA])).toBe(before + 1);
    expect((await adapter.getTenant(tenantA))?.members[0]?.status).toBe('suspended');
    await adapter.setMemberSuspended(tenantA, memberA, false, ctx('Rehired'));
    expect((await adapter.getTenant(tenantA))?.members[0]?.status).toBe('active');
  });

  it('refuses to suspend a member through another business', async () => {
    await expect(adapter.setMemberSuspended(tenantB, memberA, true, ctx('Wrong tenant'))).rejects.toMatchObject({ status: 404 });
  });

  it('trial end is an absolute date: repeating it is a no-op, and a lifecycle restriction is lifted', async () => {
    await admin.query("UPDATE subscription SET status = 'restricted' WHERE tenant_id = $1", [tenantB]);
    await admin.query("UPDATE tenant SET status = 'restricted' WHERE id = $1", [tenantB]);
    const end = new Date(Date.now() + 14 * 86_400_000);
    const first = await adapter.setTrialEnd(tenantB, end, ctx('Pilot extension'));
    expect(first.changed).toBe(true);
    expect(first.tenant.status).toBe('active');
    expect(first.tenant.subscription).toMatchObject({ status: 'trialing', trial_ends_at: end.toISOString(), grace_ends_at: null });
    const again = await adapter.setTrialEnd(tenantB, end, ctx('Same date clicked again'));
    expect(again.changed).toBe(false);
  });

  it('extending a trial never lifts a manual operator lock', async () => {
    await adapter.setTenantLocked(tenantA, true, ctx('Manual hold'));
    const result = await adapter.setTrialEnd(tenantA, new Date(Date.now() + 10 * 86_400_000), ctx('Extend while held'));
    expect(result.tenant.status).toBe('restricted');
    await adapter.setTenantLocked(tenantA, false, ctx('Release hold'));
  });

  it('activation after manual payment writes one converted event even when double-fired concurrently', async () => {
    const context = ctx('GCash payment verified');
    const end = new Date(Date.now() + 31 * 86_400_000);
    const results = await Promise.all(Array.from({ length: 3 }, () => adapter.activateSubscription(tenantA, end, context)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results[0]?.tenant.subscription?.status).toBe('active');
    expect(await count("SELECT count(*) n FROM subscription_event WHERE tenant_id = $1 AND event_type = 'converted'", [tenantA])).toBe(1);
    await expect(adapter.setTrialEnd(tenantA, new Date(Date.now() + 5 * 86_400_000), ctx('Trial after paid'))).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to unlock a business whose subscription is restricted', async () => {
    await admin.query("UPDATE subscription SET status = 'restricted' WHERE tenant_id = $1", [tenantB]);
    await admin.query("UPDATE tenant SET status = 'restricted' WHERE id = $1", [tenantB]);
    await expect(adapter.setTenantLocked(tenantB, false, ctx('Try unlock'))).rejects.toMatchObject({ status: 409 });
  });

  it('profile edits validate nothing-changed as a no-op and record an audit row', async () => {
    const renamed = await adapter.updateProfile(tenantA, { name: 'Luna Gown Rentals' }, ctx('Owner requested rename'));
    expect(renamed).toMatchObject({ changed: true });
    expect(renamed.tenant.name).toBe('Luna Gown Rentals');
    expect((await adapter.updateProfile(tenantA, { name: 'Luna Gown Rentals' }, ctx('Same name'))).changed).toBe(false);
  });

  it('fails closed when configured with a role that bypasses row-level security', async () => {
    const unsafe = createTenantAdminDbAdapter({ connectionString: `postgres://postgres:it-super@localhost:${PORT}/drezivo` });
    await expect(unsafe.listTenants()).rejects.toMatchObject({ status: 503 });
    await unsafe.close();
  });

  /** A fresh trialing business with one pending ₱300 proof of payment. */
  async function businessWithPendingPayment(tenantId: string, slug: string): Promise<string> {
    await admin.query('INSERT INTO tenant (id, clerk_org_id, name, slug) VALUES ($1, $2, $3, $4)', [tenantId, `org_${slug}`, slug, slug]);
    const subscription = await admin.query<{ id: string }>(
      `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
       VALUES ($1, $2, 'trialing', now() + interval '2 days', now(), now() + interval '2 days') RETURNING id`,
      [tenantId, planId],
    );
    const payment = await admin.query<{ id: string }>(
      `INSERT INTO subscription_payment (tenant_id, subscription_id, amount_minor, currency, status, collection_method, business_key, reference)
       VALUES ($1, $2, 30000, 'PHP', 'pending', 'manual_qr', $3, 'GC-REF-1') RETURNING id`,
      [tenantId, subscription.rows[0]!.id, `it-payment-${slug}`],
    );
    return payment.rows[0]!.id;
  }

  it('approving a proof is duplicate-safe, adds one month after the trial end, and queues one owner email', async () => {
    const tenantC = '44444444-4444-4444-8444-444444444444';
    const paymentId = await businessWithPendingPayment(tenantC, 'gala-rentals');
    const queue = await adapter.listPayments('pending');
    expect(queue.find((row) => row.payment_id === paymentId)).toMatchObject({ tenant_name: 'gala-rentals', reference: 'GC-REF-1', has_proof: false });
    expect((await adapter.listTenants()).find((t) => t.tenant_id === tenantC)?.pending_payment).toBe(true);

    const context = ctx('Reference matched');
    const results = await Promise.all(Array.from({ length: 4 }, () => adapter.reviewPayment(tenantC, paymentId, 'approve', context)));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);

    const state = (await admin.query<{ status: string; expected_end: boolean; payment_status: string; reviewed_by: string }>(
      `SELECT s.status, s.current_period_end = s.trial_ends_at + interval '1 month' AS expected_end,
              sp.status AS payment_status, sp.reviewed_by
         FROM subscription s JOIN subscription_payment sp ON sp.subscription_id = s.id WHERE sp.id = $1`,
      [paymentId],
    )).rows[0];
    expect(state).toEqual({ status: 'active', expected_end: true, payment_status: 'verified', reviewed_by: 'user_operator' });
    expect(await count("SELECT count(*) n FROM subscription_event WHERE tenant_id = $1 AND event_type = 'converted'", [tenantC])).toBe(1);
    const outbox = await admin.query<{ payload: unknown }>("SELECT payload FROM outbox_event WHERE tenant_id = $1 AND event_type = 'subscription.payment_reviewed'", [tenantC]);
    expect(outbox.rows.map((row) => row.payload)).toEqual([{ payment_id: paymentId, outcome: 'approved' }]);

    await expect(adapter.reviewPayment(tenantC, paymentId, 'reject', ctx('Changed my mind'))).rejects.toMatchObject({ status: 409 });
    expect((await adapter.reviewPayment(tenantC, paymentId, 'approve', ctx('Clicked approve again'))).changed).toBe(false);
  });

  it('rejecting keeps access unchanged, stores the reason for the owner, and stays inside its business', async () => {
    const tenantD = '55555555-5555-4555-8555-555555555555';
    const paymentId = await businessWithPendingPayment(tenantD, 'rosa-bridal');
    await adapter.reviewPayment(tenantD, paymentId, 'reject', ctx('Amount was 200, not 300'));
    const row = (await admin.query<{ status: string; review_note: string; sub_status: string }>(
      `SELECT sp.status, sp.review_note, s.status AS sub_status FROM subscription_payment sp
         JOIN subscription s ON s.id = sp.subscription_id WHERE sp.id = $1`,
      [paymentId],
    )).rows[0];
    expect(row).toEqual({ status: 'failed', review_note: 'Amount was 200, not 300', sub_status: 'trialing' });
    expect(await count("SELECT count(*) n FROM outbox_event WHERE tenant_id = $1 AND payload ->> 'outcome' = 'rejected'", [tenantD])).toBe(1);
    await expect(adapter.reviewPayment(tenantD, '99999999-9999-4999-8999-999999999999', 'approve', ctx('Unknown payment'))).rejects.toMatchObject({ status: 404 });
    await expect(adapter.reviewPayment(tenantA, paymentId, 'approve', ctx('Other business'))).rejects.toMatchObject({ status: 404 });
  });

  it('records a view-only extension and an operator note, keeping the note text out of the audit log', async () => {
    const until = new Date(Math.floor((Date.now() + 7 * 86_400_000) / 1000) * 1000);
    const extended = await adapter.extendReadOnly(tenantB, until, ctx('Owner paying on Friday'));
    expect(extended.tenant.subscription?.grace_ends_at).toBe(until.toISOString());
    expect((await adapter.extendReadOnly(tenantB, until, ctx('Same date again'))).changed).toBe(false);
    const noted = await adapter.addNote(tenantB, 'Called the owner; paying Friday.', 'ops@drezivo.shop', ctx('Operator note'));
    expect(noted.tenant.notes[0]).toMatchObject({ body: 'Called the owner; paying Friday.', author_label: 'ops@drezivo.shop' });
    const audit = await admin.query("SELECT redacted_summary FROM audit_event WHERE tenant_id = $1 AND action = 'operator.tenant.note.add'", [tenantB]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain('paying Friday');
  });

  describe('Drezivo payment methods', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    const fields = (label: string) => ({ label, account_name: 'Drezivo', account_number: '09171234567', instructions: null, sort_order: 0 });

    it('creates once under concurrent double-fire and refuses the same key for a different body', async () => {
      const context = ctx('Pilot launch');
      const results = await Promise.all(Array.from({ length: 4 }, () => platform.create(fields('GCash'), { bytes: png, mime: 'image/png' }, context)));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(results.map((r) => r.method.id)).size).toBe(1);
      expect(await count("SELECT count(*) n FROM platform_payment_method WHERE label = 'GCash'")).toBe(1);
      expect(await count('SELECT count(*) n FROM platform_payment_method_change WHERE intent_key = $1', [context.idempotencyKey])).toBe(1);
      await expect(platform.create(fields('Maya'), null, context)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      const qr = await platform.readQr(results[0]!.method.id);
      expect(qr?.mime).toBe('image/png');
      expect(qr?.bytes.equals(png)).toBe(true);
    });

    it('updates at the edited version only, and keeps or removes the QR as asked', async () => {
      const created = await platform.create(fields('BPI'), { bytes: png, mime: 'image/png' }, ctx('Add bank'));
      const id = created.method.id;
      const kept = await platform.update(id, 1, { ...fields('BPI Savings'), sort_order: 2 }, undefined, ctx('Rename'));
      expect(kept.method).toMatchObject({ label: 'BPI Savings', sort_order: 2, has_qr: true, version: 2 });
      await expect(platform.update(id, 1, fields('Stale edit'), undefined, ctx('Stale'))).rejects.toMatchObject({ status: 409 });
      const removed = await platform.update(id, 2, fields('BPI Savings'), null, ctx('QR expired'));
      expect(removed.method.has_qr).toBe(false);
      expect(await platform.readQr(id)).toBeNull();
    });

    it('allows at most ten active methods even when activations race', async () => {
      await admin.query('UPDATE platform_payment_method SET active = false');
      for (let index = 0; index < 9; index += 1) await platform.create(fields(`Method ${index}`), null, ctx(`Seed ${index}`));
      const spare = await platform.create(fields('Spare'), null, ctx('Spare one'));
      await platform.setActive(spare.method.id, 1, false, ctx('Park it'));
      const racers = await Promise.allSettled([
        platform.setActive(spare.method.id, 2, true, ctx('Race A')),
        platform.create(fields('Race B'), null, ctx('Race B')),
      ]);
      expect(racers.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(racers.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'PAYMENT_METHOD_LIMIT' } });
      expect(await count('SELECT count(*) n FROM platform_payment_method WHERE active')).toBe(10);
    });
  });
});
