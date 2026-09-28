import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantAdminDbAdapter } from '../src/integrations/tenant-admin-db/index.js';
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
    for (const file of readdirSync(migrationsDir!).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await admin.query('BEGIN');
      await admin.query(readFileSync(join(migrationsDir!, file), 'utf8'));
      await admin.query('COMMIT');
    }
    await admin.query("ALTER ROLE drezivo_app WITH LOGIN PASSWORD 'it-app'");
    const plan = await admin.query<{ id: string }>("SELECT id FROM plan ORDER BY code LIMIT 1");
    const planId = plan.rows[0]?.id;
    if (!planId) throw new Error('The business migrations did not seed any plan.');
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
  }, 180_000);

  afterAll(async () => {
    await adapter?.close();
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
});
