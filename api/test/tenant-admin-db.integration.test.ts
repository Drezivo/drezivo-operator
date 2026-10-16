import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { requestId, errorHandler } from '../src/middleware.js';
import { createOperatorConsoleRouter } from '../src/operator-console/index.js';
import { createSessionWebhookRouter } from '../src/operator-console/session-webhook.js';
import { createConsoleDbAdapter } from '../src/integrations/console-db/index.js';
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
  let server: EmbeddedPostgres | undefined;
  let consoleStore: ReturnType<typeof createConsoleDbAdapter>;
  let runtimeUrl: string;
  let adminUrl: string;
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
    if (process.env.OPERATOR_LOCAL_IT === 'true') {
      if (process.env.NODE_ENV !== 'test') throw new Error('Docker integration requires test mode.');
      const credentials = JSON.parse(readFileSync('/run/secrets/credentials', 'utf8')) as { databasePassword: string };
      const database = `operator_it_${randomUUID().replaceAll('-', '')}`;
      const cluster = new pg.Client({host:'test-db',port:5432,user:'postgres',password:credentials.databasePassword,database:'operator_test'});
      await cluster.connect();
      try { await cluster.query(`CREATE DATABASE "${database}"`); } finally { await cluster.end(); }
      adminUrl = `postgres://postgres:${encodeURIComponent(credentials.databasePassword)}@test-db:5432/${database}`;
      runtimeUrl = `postgres://drezivo_app:it-app@test-db:5432/${database}`;
      admin = new pg.Client({ connectionString: adminUrl });
    } else {
      const root = process.env.TENANT_ADMIN_IT_DATA_ROOT ?? join(process.cwd(), '.it-data');
      server = new EmbeddedPostgres({ databaseDir: mkdtempSync(join(root, 'pg-')), user: 'postgres', password: 'it-super', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
      await server.initialise(); await server.start(); await server.createDatabase('drezivo');
      adminUrl = `postgres://postgres:it-super@localhost:${PORT}/drezivo`;
      runtimeUrl = `postgres://drezivo_app:it-app@localhost:${PORT}/drezivo`;
      admin = new pg.Client({connectionString:adminUrl});
    }
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
    adapter = createTenantAdminDbAdapter({ connectionString: runtimeUrl });
    platform = createPlatformPaymentsDbAdapter({ connectionString: runtimeUrl });
    consoleStore = createConsoleDbAdapter({connectionString:runtimeUrl});
  }, 180_000);

  afterAll(async () => {
    await consoleStore?.close();
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
    const unsafe = createTenantAdminDbAdapter({ connectionString: adminUrl });
    await expect(unsafe.listTenants()).rejects.toMatchObject({ status: 503 });
    await unsafe.close();
  });

  /** A fresh trialing business with a pending payment at the server-owned plan price. */
  async function businessWithPendingPayment(tenantId: string, slug: string): Promise<string> {
    await admin.query('INSERT INTO tenant (id, clerk_org_id, name, slug) VALUES ($1, $2, $3, $4)', [tenantId, `org_${slug}`, slug, slug]);
    const subscription = await admin.query<{ id: string }>(
      `INSERT INTO subscription (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
       VALUES ($1, $2, 'trialing', now() + interval '2 days', now(), now() + interval '2 days') RETURNING id`,
      [tenantId, planId],
    );
    const payment = await admin.query<{ id: string }>(
      `INSERT INTO subscription_payment (tenant_id, subscription_id, amount_minor, currency, status, collection_method, business_key, reference)
       SELECT $1, $2, monthly_minor, currency, 'pending', 'manual_qr', $3, 'GC-REF-1' FROM plan WHERE id=$4 RETURNING id`,
      [tenantId, subscription.rows[0]!.id, `it-payment-${slug}`, planId],
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
  it('never returns merchant activity in detail or platform audit, while preserving the source row',async()=>{
    await admin.query("INSERT INTO audit_event(tenant_id,actor_kind,actor_key,action,entity_type,outcome,redacted_summary,request_id,occurred_at) VALUES($1,'staff','membership:local','catalogue.item.created','product','succeeded','{\"private\":\"do-not-expose\"}','private-merchant-check',now())",[tenantA]);
    expect((await adapter.getTenant(tenantA))?.recent_audit).toEqual([]);
    const page=await consoleStore.audit.listAuditEvents({filters:{tenant_id:tenantA},limit:100,cursor:null,requestId:'audit-it'});
    expect(JSON.stringify(page)).not.toContain('do-not-expose');
    expect(page.items.some(e=>e.action==='catalogue.item.created')).toBe(false);
    expect(await count("SELECT count(*) n FROM audit_event WHERE request_id='private-merchant-check'")).toBe(1);
  });

  it('records each verified session event once under sequential and concurrent duplicate attempts',async()=>{
    const sessionId=randomUUID(),subject='user_session_test';
    const event={sessionId,subject,event:'started' as const,requestId:'session-it'};
    expect(await consoleStore.session.record(event)).toEqual({recorded:true});
    expect(await consoleStore.session.record(event)).toEqual({recorded:false});
    expect(await Promise.all([consoleStore.session.record(event),consoleStore.session.record(event)])).toEqual([{recorded:false},{recorded:false}]);
    expect(await consoleStore.session.isKnown(subject,sessionId)).toBe(true);
    expect(await consoleStore.session.isEnded(subject,sessionId)).toBe(false);
    await Promise.all([consoleStore.session.record({...event,event:'ended'}),consoleStore.session.record({...event,event:'ended'})]);
    expect(await count("SELECT count(*) n FROM global_audit_event WHERE actor_key='operator:user_session_test' AND action='operator.session.ended'")).toBe(1);
    expect(await consoleStore.session.isEnded(subject,sessionId)).toBe(true);
    expect(JSON.stringify((await admin.query("SELECT entity_id,redacted_summary FROM global_audit_event WHERE actor_key='operator:user_session_test'")).rows)).not.toContain(sessionId);
  });

  it('verifies Clerk session webhook raw bytes and deduplicates concurrent delivery without provider calls',async()=>{
    const sessionId='sess_local_webhook',subject='user_webhook';
    await consoleStore.session.record({subject,sessionId,event:'started',requestId:'session-webhook-start'});
    const secret=randomBytes(32),signingSecret=`whsec_${secret.toString('base64')}`;
    const app=express();app.use(requestId);app.use(createSessionWebhookRouter(consoleStore.session,signingSecret,(_req,_res,next)=>next()));app.use(errorHandler);
    const body=JSON.stringify({type:'session.ended',timestamp:Date.now(),data:{id:sessionId,user_id:subject}});
    const id='msg_local_webhook',timestamp=String(Math.floor(Date.now()/1000));
    const signature=`v1,${createHmac('sha256',secret).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
    const send=(raw=body)=>request(app).post('/webhooks/operator-clerk').set('Content-Type','application/json').set('svix-id',id).set('svix-timestamp',timestamp).set('svix-signature',signature).send(raw);
    expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);
    expect((await Promise.all([send(),send()])).map(r=>r.status)).toEqual([200,200]);
    expect(await count("SELECT count(*) n FROM global_audit_event WHERE actor_key='operator:user_webhook' AND action='operator.session.ended'")).toBe(1);
    expect((await send(body+' ')).status).toBe(401);
  });

  it('returns subscriptions with database prices, recorded payer, reviewer and due dates',async()=>{
    const page=await consoleStore.billing.listSubscriptions({principal:{clerkUserId:'user_operator',operatorOrganizationId:'org_operator',roles:['platform_owner'],requestId:'ledger-it'},filters:{},limit:100,cursor:null,requestId:'ledger-it'});
    expect(page.items.every(s=>/^[0-9]+$/.test(s.amount_minor??''))).toBe(true);
    const verified=page.items.find(s=>s.paid_at!==null&&s.paid_at!==undefined);
    expect(verified?.reviewed_by).toBe('user_operator');
    expect(verified?.current_period_end).toBeTruthy();
  });

  it('rejects an idempotency key reused for a changed request',async()=>{
    const key=ctx('Fingerprint test');
    await adapter.updateProfile(tenantA,{name:'Local Fingerprint One'},{...key,requestFingerprint:'one'});
    await expect(adapter.updateProfile(tenantA,{name:'Local Fingerprint Two'},{...key,requestFingerprint:'two'})).rejects.toMatchObject({status:409});
    expect((await adapter.getTenant(tenantA))?.name).toBe('Local Fingerprint One');
  });

  it('requires operator database context and refuses privileged credentials',async()=>{
    const runtime=new pg.Client({connectionString:runtimeUrl});await runtime.connect();
    try{await expect(runtime.query("SELECT operator_console_projection('audit','{}')")).rejects.toMatchObject({code:'42501'});}finally{await runtime.end();}
    const unsafe=createConsoleDbAdapter({connectionString:adminUrl});
    try{await expect(unsafe.audit.listAuditEvents({filters:{},limit:1,cursor:null,requestId:'unsafe-it'})).rejects.toMatchObject({status:503});}finally{await unsafe.close();}
  });

  it('validates session HTTP events, derives identity from authentication and tolerates double-fire',async()=>{
    const subject='user_http_session',sessionId=randomUUID();
    const app=express();app.use(requestId,express.json());
    app.use('/api/v1',createOperatorConsoleRouter({session:consoleStore.session},(_req,res,next)=>{res.locals.operatorPrincipal={clerkUserId:subject,sessionId,operatorOrganizationId:'org_operator',roles:['platform_owner'],requestId:String(res.locals.requestId)};next();},()=> (_req,_res,next)=>next()));app.use(errorHandler);
    const key=randomUUID();const send=(body:object={event:'started'})=>request(app).post('/api/v1/session/events').set('Idempotency-Key',key).send(body);
    expect((await request(app).post('/api/v1/session/events').send({event:'started'})).status).toBe(400);
    expect((await send({event:'started',subject:'user_forged'})).status).toBe(400);
    expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);
    expect((await Promise.all([send(),send()])).map(r=>r.status)).toEqual([200,200]);
    expect(await count("SELECT count(*) n FROM global_audit_event WHERE actor_key='operator:user_http_session' AND action='operator.session.started'")).toBe(1);
    await send({event:'ended'});await send({event:'ended'});await Promise.all([send({event:'ended'}),send({event:'ended'})]);
    expect(await count("SELECT count(*) n FROM global_audit_event WHERE actor_key='operator:user_http_session' AND action='operator.session.sign_out_requested'")).toBe(1);
    expect(await consoleStore.session.isEnded(subject,sessionId)).toBe(false);
  });

  describe('scoped workspace repair and permanent clothing deletion', () => {
    const subject = 'user_workspace_founder';
    const execute = (operation: Parameters<typeof consoleStore.workspace.execute>[0]['operation'], tenantId: string, input: Record<string, unknown>, grantId?: string, idempotencyKey?: string, operator = subject) => consoleStore.workspace.execute({ operation, tenantId, input, grantId, idempotencyKey, subject: operator, requestId: 'workspace-it' });
    const open = async (mode: 'read' | 'repair' = 'repair', tenantId = tenantA, operator = subject) => execute('open', tenantId, { mode, minutes: 30, reason: 'Investigate synthetic encoding issue' }, undefined, randomUUID(), operator) as Promise<{grant_id:string}>;
    const seedClothing = async (tenantId = tenantA) => {
      const id = randomUUID(), variant = randomUUID(), asset = randomUUID(), branch = randomUUID();
      await admin.query("INSERT INTO branch(id,tenant_id,name,code,timezone) VALUES($1,$2,'Local support branch',$3,'Asia/Manila')", [branch,tenantId,branch]);
      await admin.query("INSERT INTO product(id,tenant_id,name,code,status) VALUES($1,$2,'Synthetic incorrect clothing',$3,'active')", [id,tenantId,id]);
      await admin.query("INSERT INTO product_variant(id,tenant_id,product_id,sku,size_label,rental_price_minor,included_duration_minutes) VALUES($1,$2,$3,$4,'M',10000,1440)", [variant,tenantId,id,variant]);
      await admin.query("INSERT INTO physical_asset(id,tenant_id,branch_id,variant_id,asset_code) VALUES($1,$2,$3,$4,$5)", [asset,tenantId,branch,variant,asset]);
      return {id,variant,asset,branch};
    };
    const deletion = (preview: {id:string;name:string;fingerprint:string}) => ({resource:'clothing',id:preview.id,fingerprint:preview.fingerprint,confirm_name:preview.name,confirm_id:preview.id,acknowledge:'PERMANENTLY DELETE',reason:'Remove synthetic incorrectly encoded record'});
    const preview = (grantId:string,id:string) => execute('delete-preview',tenantA,{resource:'clothing',id},grantId) as Promise<{id:string;name:string;fingerprint:string;can_delete:boolean;blockers:Record<string,number>}>;

    it('opens one grant for sequential and concurrent duplicate requests, and rejects changed intent', async () => {
      const key=randomUUID(),input={mode:'repair',minutes:30,reason:'Test duplicate access intent'};
      const first=await execute('open',tenantA,input,undefined,key);
      expect(await execute('open',tenantA,input,undefined,key)).toEqual(first);
      expect(await Promise.all([execute('open',tenantA,input,undefined,key),execute('open',tenantA,input,undefined,key)])).toEqual([first,first]);
      await expect(execute('open',tenantA,{...input,mode:'read'},undefined,key)).rejects.toMatchObject({status:409});
      expect(await count("SELECT count(*) n FROM support_grant WHERE reason='Test duplicate access intent'")).toBe(1);
    });
    it('serializes first-arrival races for opening, correcting and closing access', async () => {
      const openKey=randomUUID(),input={mode:'repair',minutes:30,reason:'First arrival race verification'};
      const opened=await Promise.all([execute('open',tenantA,input,undefined,openKey),execute('open',tenantA,input,undefined,openKey)]);
      expect(opened[0]).toEqual(opened[1]); const grantId=(opened[0] as {grant_id:string}).grant_id;
      expect(await count("SELECT count(*) n FROM support_grant WHERE reason='First arrival race verification'")).toBe(1);
      const item=await seedClothing(),detail=await execute('detail',tenantA,{resource:'clothing',id:item.id},grantId) as {fingerprint:string};
      const body={resource:'clothing',id:item.id,fingerprint:detail.fingerprint,changes:{code:'LOCAL-RACE-'+item.id},reason:'Correct synthetic code concurrently'},key=randomUUID();
      const corrected=await Promise.all([execute('correct',tenantA,body,grantId,key),execute('correct',tenantA,body,grantId,key)]);
      expect(corrected[0]).toEqual(corrected[1]);
      expect(await count("SELECT count(*) n FROM audit_event WHERE entity_id=$1 AND action='operator.workspace.correct'",[item.id])).toBe(1);
      const closeKey=randomUUID(),closed=await Promise.all([execute('close',tenantA,{},grantId,closeKey),execute('close',tenantA,{},grantId,closeKey)]);
      expect(closed[0]).toEqual(closed[1]); expect(await execute('close',tenantA,{},grantId,closeKey)).toEqual(closed[0]);
      expect(await count("SELECT count(*) n FROM audit_event WHERE support_grant_id=$1 AND action='operator.workspace.close'",[grantId])).toBe(1);
    });
    it('binds access to the tenant and actual operator, with no subscription lock dependency', async () => {
      const g=await open();
      expect(await execute('list',tenantA,{resource:'clothing'},g.grant_id)).toMatchObject({resource:'clothing'});
      await expect(execute('list',tenantB,{resource:'clothing'},g.grant_id)).rejects.toMatchObject({status:403});
      await expect(execute('list',tenantA,{resource:'clothing'},g.grant_id,undefined,'user_workspace_ryanny')).rejects.toMatchObject({status:403});
      const ryanny=await open('repair',tenantB,'user_workspace_ryanny');
      expect(await execute('list',tenantB,{resource:'branches'},ryanny.grant_id,undefined,'user_workspace_ryanny')).toMatchObject({resource:'branches'});
    });
    it('resumes only a current own workspace grant and audits the read', async () => {
      const g=await open('read');
      expect(await execute('status',tenantA,{},g.grant_id)).toMatchObject({grant_id:g.grant_id,tenant_id:tenantA,mode:'read',operator_subject:subject});
      await expect(execute('status',tenantB,{},g.grant_id)).rejects.toMatchObject({status:403});
      await expect(execute('status',tenantA,{},g.grant_id,undefined,'user_workspace_ryanny')).rejects.toMatchObject({status:403});
      await execute('close',tenantA,{},g.grant_id,randomUUID());
      await expect(execute('status',tenantA,{},g.grant_id)).rejects.toMatchObject({status:403});
    });
    it('enforces read-only in the database even if the HTTP layer is bypassed', async () => {
      const g=await open('read'),item=await seedClothing();
      const d=await execute('detail',tenantA,{resource:'clothing',id:item.id},g.grant_id) as {fingerprint:string};
      await expect(execute('correct',tenantA,{resource:'clothing',id:item.id,fingerprint:d.fingerprint,changes:{name:'Forbidden correction'},reason:'Attempt unauthorized mutation'},g.grant_id,randomUUID())).rejects.toMatchObject({status:403});
      const p=await preview(g.grant_id,item.id);
      await expect(execute('delete',tenantA,deletion(p),g.grant_id,randomUUID())).rejects.toMatchObject({status:403});
      expect(await count('SELECT count(*) n FROM product WHERE id=$1',[item.id])).toBe(1);
    });
    it('rejects expired, scheduled, revoked and unknown permission scopes', async () => {
      for(const mutation of ["starts_at=now()-interval '1 hour',expires_at=now()-interval '1 second'","starts_at=now()+interval '1 hour',expires_at=now()+interval '2 hours'","revoked_at=now()","permission_codes='[\"workspace.read\",\"unknown.scope\"]'"]){
        const g=await open(); await admin.query(`UPDATE support_grant SET ${mutation} WHERE id=$1`,[g.grant_id]);
        await expect(execute('list',tenantA,{resource:'clothing'},g.grant_id)).rejects.toMatchObject({status:403});
      }
    });
    it('allows an expired own grant to be closed without granting data access', async () => {
      const g=await open(); await admin.query("UPDATE support_grant SET starts_at=now()-interval '1 hour',expires_at=now()-interval '1 second' WHERE id=$1",[g.grant_id]);
      await expect(execute('list',tenantA,{resource:'clothing'},g.grant_id)).rejects.toMatchObject({status:403});
      expect(await execute('close',tenantA,{},g.grant_id,randomUUID())).toMatchObject({closed:true});
    });
    it('closes access once under sequential and concurrent double-fire', async () => {
      const g=await open(),key=randomUUID();
      const first=await execute('close',tenantA,{},g.grant_id,key);
      expect(await execute('close',tenantA,{},g.grant_id,key)).toEqual(first);
      expect(await Promise.all([execute('close',tenantA,{},g.grant_id,key),execute('close',tenantA,{},g.grant_id,key)])).toEqual([first,first]);
      await expect(execute('list',tenantA,{resource:'clothing'},g.grant_id)).rejects.toMatchObject({status:403});
      expect(await count("SELECT count(*) n FROM audit_event WHERE support_grant_id=$1 AND action='operator.workspace.close'",[g.grant_id])).toBe(1);
    });
    it('reads every operational module and excludes personal data, evidence, credentials and merchant logs', async () => {
      const g=await open('read');
      await admin.query("INSERT INTO customer(tenant_id,full_name,email,phone,notes) VALUES($1,'PRIVATE-CUSTOMER-NAME','private@example.invalid','PRIVATE-PHONE','PRIVATE-NOTE')",[tenantA]);
      for(const resource of ['clothing','variants','assets','categories','branches','reservations','reservation-lines','fittings','fitting-lines','customers','memberships','payments','charges','deposits','refunds','maintenance','allocations','custody','disruptions','storefronts','files','jobs']){
        const data=await execute('list',tenantA,{resource},g.grant_id);
        expect(data).toMatchObject({resource});
        expect(JSON.stringify(data)).not.toMatch(/PRIVATE-CUSTOMER|private@example|PRIVATE-PHONE|PRIVATE-NOTE|storage_key|lease_token|clerk_user_id|customer_snapshot|safe_last_error/);
      }
      await expect(execute('list',tenantA,{resource:'audit_event'},g.grant_id)).rejects.toMatchObject({status:400});
    });
    it('corrects encoding once, rejects stale edits and prevents immutable field changes', async () => {
      const g=await open(),item=await seedClothing();
      const detail=await execute('detail',tenantA,{resource:'clothing',id:item.id},g.grant_id) as {fingerprint:string};
      const body={resource:'clothing',id:item.id,fingerprint:detail.fingerprint,changes:{name:'Corrected synthetic clothing'},reason:'Correct the synthetic encoded name'},key=randomUUID();
      const first=await execute('correct',tenantA,body,g.grant_id,key);
      expect(await execute('correct',tenantA,body,g.grant_id,key)).toEqual(first);
      expect(await Promise.all([execute('correct',tenantA,body,g.grant_id,key),execute('correct',tenantA,body,g.grant_id,key)])).toEqual([first,first]);
      await expect(execute('correct',tenantA,{...body,changes:{name:'Stale synthetic edit'}},g.grant_id,randomUUID())).rejects.toMatchObject({status:409});
      const next=await execute('detail',tenantA,{resource:'clothing',id:item.id},g.grant_id) as {fingerprint:string};
      await expect(execute('correct',tenantA,{...body,fingerprint:next.fingerprint,changes:{tenant_id:tenantB}},g.grant_id,randomUUID())).rejects.toMatchObject({status:400});
      expect(await count("SELECT count(*) n FROM audit_event WHERE entity_id=$1 AND action='operator.workspace.correct'",[item.id])).toBe(1);
      expect((await admin.query('SELECT reason FROM operator_command WHERE resource_id=$1',[item.id])).rows[0]?.reason).toBe(body.reason);
    });
    it('rejects another workspace item even with a valid grant for this workspace', async () => {
      const g=await open(),foreign=await seedClothing(tenantB);
      await expect(preview(g.grant_id,foreign.id)).rejects.toMatchObject({status:404});
      await expect(execute('detail',tenantA,{resource:'clothing',id:foreign.id},g.grant_id)).rejects.toMatchObject({status:404});
    });
    it('requires exact name, ID and permanent deletion acknowledgement', async () => {
      const g=await open(),item=await seedClothing(),p=await preview(g.grant_id,item.id),body=deletion(p);
      for(const changes of [{confirm_name:'Wrong garment'},{confirm_id:randomUUID()},{acknowledge:'archive'}]) await expect(execute('delete',tenantA,{...body,...changes},g.grant_id,randomUUID())).rejects.toMatchObject({status:409});
      expect(await count('SELECT count(*) n FROM product WHERE id=$1',[item.id])).toBe(1);
    });
    it('invalidates deletion confirmation when stock changes after preview', async () => {
      const g=await open(),item=await seedClothing(),p=await preview(g.grant_id,item.id);
      await admin.query('UPDATE physical_asset SET version=version+1 WHERE id=$1',[item.asset]);
      await expect(execute('delete',tenantA,deletion(p),g.grant_id,randomUUID())).rejects.toMatchObject({status:409});
      expect(await count('SELECT count(*) n FROM product WHERE id=$1',[item.id])).toBe(1);
    });
    it('reports dependencies and preserves clothing linked to operational history', async () => {
      const g=await open(),item=await seedClothing();
      await admin.query("INSERT INTO maintenance_work_order(tenant_id,branch_id,asset_id,kind,reason) VALUES($1,$2,$3,'repair','Synthetic maintenance reference')",[tenantA,item.branch,item.asset]);
      const p=await preview(g.grant_id,item.id);expect(p.can_delete).toBe(false);expect(p.blockers.maintenance).toBe(1);
      await expect(execute('delete',tenantA,deletion(p),g.grant_id,randomUUID())).rejects.toMatchObject({status:409});
      expect(await count('SELECT count(*) n FROM physical_asset WHERE id=$1',[item.asset])).toBe(1);
    });
    it('blocks booked clothing without changing reservation snapshots or balances', async () => {
      const g=await open(),item=await seedClothing(),store=randomUUID(),policy=randomUUID(),method=randomUUID(),reservation=randomUUID();
      await admin.query('INSERT INTO storefront(id,tenant_id,branch_id,slug) VALUES($1,$2,$3,$4)',[store,tenantA,item.branch,store]);
      await admin.query("INSERT INTO policy_snapshot(id,tenant_id,storefront_id,version,rental_rules,deposit_rules,cancellation_rules,delivery_rules,privacy_notice,effective_at) VALUES($1,$2,$3,1,'{}','{}','{}','{}','Synthetic privacy notice',now())",[policy,tenantA,store]);
      await admin.query("INSERT INTO payment_method(id,tenant_id,name,rail,destination_snapshot) VALUES($1,$2,'Local test cash','cash','{}')",[method,tenantA]);
      await admin.query("INSERT INTO reservation(id,tenant_id,branch_id,storefront_id,policy_snapshot_id,payment_method_id,reference_code,pickup_at,due_at,timezone_snapshot,price_snapshot,rental_total_minor,due_now_minor) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 day',now()+interval '2 days','Asia/Manila','{}',10000,10000)",[reservation,tenantA,item.branch,store,policy,method,reservation]);
      await admin.query("INSERT INTO reservation_line(tenant_id,reservation_id,variant_id,name_snapshot,measurements_snapshot,pricing_snapshot,rental_minor) VALUES($1,$2,$3,'Synthetic reserved clothing','{}','{}',10000)",[tenantA,reservation,item.variant]);
      const p=await preview(g.grant_id,item.id);expect(p.blockers.reservation_lines).toBe(1);expect(p.can_delete).toBe(false);
      await expect(execute('delete',tenantA,deletion(p),g.grant_id,randomUUID())).rejects.toMatchObject({status:409});
      expect((await admin.query('SELECT rental_total_minor,due_now_minor FROM reservation WHERE id=$1',[reservation])).rows[0]).toEqual({rental_total_minor:10000,due_now_minor:10000});
      expect(await count('SELECT count(*) n FROM reservation_line WHERE reservation_id=$1',[reservation])).toBe(1);
      expect(await count('SELECT count(*) n FROM product_variant WHERE id=$1',[item.variant])).toBe(1);
    });
    it('does not expose the helper functions or workspace function without verified operator database context', async () => {
      const runtime=new pg.Client({connectionString:runtimeUrl});await runtime.connect();
      try{
        await expect(runtime.query("SELECT operator_workspace('list','user_other',$1,NULL,NULL,'context-test','{}')",[tenantA])).rejects.toMatchObject({code:'42501'});
        await expect(runtime.query('SELECT operator_clothing_delete_preview($1,$2)',[tenantA,randomUUID()])).rejects.toMatchObject({code:'42501'});
        await expect(runtime.query("SELECT operator_workspace_resource('clothing')")).rejects.toMatchObject({code:'42501'});
      }finally{await runtime.end();}
    });
    it('physically deletes clothing once, cleans featured links, queues media cleanup and attributes the operator', async () => {
      const g=await open(),item=await seedClothing(),file=randomUUID(),store=randomUUID();
      await admin.query("INSERT INTO file_object(id,tenant_id,purpose,storage_key,mime_type,byte_size,upload_expires_at) VALUES($1,$2,'catalogue_image','local-only/synthetic-image','image/png',100,now()+interval '1 hour')",[file,tenantA]);
      await admin.query('INSERT INTO product_image(tenant_id,product_id,file_id) VALUES($1,$2,$3)',[tenantA,item.id,file]);
      await admin.query("INSERT INTO storefront(id,tenant_id,branch_id,slug,content) VALUES($1,$2,$3,$4,$5::jsonb)",[store,tenantA,item.branch,store,JSON.stringify({featured_product_ids:[item.id]})]);
      await admin.query("INSERT INTO outbox_event(tenant_id,dedupe_key,event_type,payload,status) VALUES($1,$2,'file.object_cleanup.requested',$3::jsonb,'dead')",[tenantA,`file-object-cleanup:${file}`,JSON.stringify({file_id:file})]);
      const p=await preview(g.grant_id,item.id);expect(p.can_delete).toBe(true);const key=randomUUID(),body=deletion(p);
      const results=await Promise.all([execute('delete',tenantA,body,g.grant_id,key),execute('delete',tenantA,body,g.grant_id,key),execute('delete',tenantA,body,g.grant_id,key)]);
      expect(results.every(r=>JSON.stringify(r)===JSON.stringify(results[0]))).toBe(true);
      expect(await execute('delete',tenantA,body,g.grant_id,key)).toEqual(results[0]);
      for(const [table,id] of [['product',item.id],['product_variant',item.variant],['physical_asset',item.asset]]) expect(await count(`SELECT count(*) n FROM ${table} WHERE id=$1`,[id])).toBe(0);
      expect((await admin.query('SELECT content FROM storefront WHERE id=$1',[store])).rows[0]?.content.featured_product_ids).toEqual([]);
      expect(await count("SELECT count(*) n FROM outbox_event WHERE tenant_id=$1 AND event_type='file.object_cleanup.requested' AND status='pending' AND payload->>'file_id'=$2",[tenantA,file])).toBe(1);
      expect(await count('SELECT count(*) n FROM file_object WHERE id=$1',[file])).toBe(1);
      const audit=await admin.query("SELECT actor_kind,actor_key,support_grant_id,operator_command_id,redacted_summary FROM audit_event WHERE entity_id=$1 AND action='operator.workspace.delete'",[item.id]);
      expect(audit.rows).toHaveLength(1);expect(audit.rows[0]).toMatchObject({actor_kind:'operator',actor_key:`operator:${subject}`,support_grant_id:g.grant_id});expect(audit.rows[0]?.operator_command_id).toBeTruthy();
      expect(JSON.stringify(audit.rows)).not.toContain('Synthetic incorrect clothing');
    });
  });

  it('offers notification retry only for safe parent states and queues once under double-fire', async () => {
    const ids: string[]=[];
    for (const [parentStatus,providerId] of [['dead',null],['pending',null],['dead','synthetic-accepted']] as const) {
      const job=randomUUID(),delivery=randomUUID();ids.push(delivery);
      await admin.query("INSERT INTO outbox_event(id,tenant_id,dedupe_key,event_type,payload,status) VALUES($1::uuid,$2,$1::uuid::text,'local.notification.check','{}',$3)",[job,tenantA,parentStatus]);
      await admin.query("INSERT INTO notification_delivery(id,tenant_id,outbox_id,channel,template_version,status,provider_message_id) VALUES($1,$2,$3,'email','local-test-v1','failed',$4)",[delivery,tenantA,job,providerId]);
    }
    const principal={clerkUserId:'user_operator',operatorOrganizationId:'org_operator',roles:['platform_owner' as const],requestId:'retry-it'};
    const page=await consoleStore.operations.listNotifications({principal,filters:{tenant_id:tenantA},limit:100,cursor:null,requestId:'retry-it'});
    expect(ids.map(id=>page.items.find(n=>n.delivery_id===id)?.can_retry)).toEqual([true,false,false]);
    const input={deliveryId:ids[0]!,operatorSubject:'user_operator',idempotencyKey:randomUUID(),requestId:'retry-it',reason:'Retry synthetic known failure'};
    const first=await consoleStore.retry.retryNotification(input);
    expect(await consoleStore.retry.retryNotification(input)).toEqual(first);
    expect(await Promise.all([consoleStore.retry.retryNotification(input),consoleStore.retry.retryNotification(input)])).toEqual([first,first]);
    expect(await count("SELECT count(*) n FROM audit_event WHERE entity_id=$1 AND action='operator.notification.retry'",[ids[0]])).toBe(1);
    for (const id of ids.slice(1)) await expect(consoleStore.retry.retryNotification({...input,deliveryId:id,idempotencyKey:randomUUID()})).rejects.toMatchObject({status:409});
  });

  describe('latest Free-plan contracts', () => {
    const freeIds: string[] = [randomUUID(), randomUUID()];
    let freePlanId: string;
    beforeAll(async () => {
      freePlanId = (await admin.query<{id:string}>("SELECT id FROM plan WHERE code='free' AND active ORDER BY version DESC LIMIT 1")).rows[0]!.id;
      for (const id of freeIds) {
        await admin.query('INSERT INTO tenant(id,clerk_org_id,name,slug) VALUES($1,$2,$3,$3)',[id,`org_${id}`,`free-${id}`]);
        await admin.query("INSERT INTO subscription(tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,$2,'active',now(),NULL)",[id,freePlanId]);
      }
    });
    const principal = {clerkUserId:'user_operator',operatorOrganizationId:'org_operator',roles:['platform_owner' as const],requestId:'free-it'};
    it('lists and paginates perpetual subscriptions without dropping or repeating workspaces', async () => {
      expect((await adapter.getTenant(freeIds[0]!))?.subscription).toMatchObject({plan_code:'free',status:'active',current_period_end:null});
      expect((await adapter.listTenants()).filter(t=>freeIds.includes(t.tenant_id))).toHaveLength(2);
      const first = await consoleStore.billing.listSubscriptions({principal,filters:{plan_code:'free'},limit:1,cursor:null,requestId:'free-it'});
      expect(first.next_cursor?.currentPeriodEnd).toBeNull();
      expect(first.items[0]?.current_period_end).toBeNull();
      const second = await consoleStore.billing.listSubscriptions({principal,filters:{plan_code:'free'},limit:1,cursor:first.next_cursor,requestId:'free-it'});
      expect(new Set([...first.items,...second.items].map(s=>s.tenant_id))).toEqual(new Set(freeIds));
      expect(second.next_cursor).toBeNull();
    });
    it('refuses manual expiry and trial dates for perpetual Free workspaces', async () => {
      const until = new Date(Date.now()+86400000);
      await expect(adapter.setTrialEnd(freeIds[0]!,until,ctx())).rejects.toMatchObject({status:409});
      await expect(adapter.activateSubscription(freeIds[0]!,until,ctx())).rejects.toMatchObject({status:409});
      await expect(adapter.extendReadOnly(freeIds[0]!,until,ctx())).rejects.toMatchObject({status:409});
      expect((await adapter.getTenant(freeIds[0]!))?.subscription?.current_period_end).toBeNull();
    });
    async function upgradePayment(tenantId:string, wrongPrice=false) {
      return (await admin.query<{id:string}>(`INSERT INTO subscription_payment(tenant_id,subscription_id,target_plan_id,amount_minor,currency,status,collection_method,business_key)
        SELECT s.tenant_id,s.id,p.id,p.monthly_minor+$2,p.currency,'pending','manual_qr',$3
        FROM subscription s CROSS JOIN plan p WHERE s.tenant_id=$1 AND p.code='standard' AND p.active ORDER BY p.version DESC LIMIT 1 RETURNING id`,[tenantId,wrongPrice?1:0,randomUUID()])).rows[0]!.id;
    }
    it('approves a Free upgrade once under sequential and concurrent retries, queuing business activation', async () => {
      const id=freeIds[0]!,paymentId=await upgradePayment(id),context=ctx('Verify synthetic upgrade proof');
      expect((await adapter.listPayments('pending')).find(p=>p.payment_id===paymentId)?.target_plan_code).toBe('standard');
      const results=await Promise.all([adapter.reviewPayment(id,paymentId,'approve',context),adapter.reviewPayment(id,paymentId,'approve',context)]);
      expect(results.filter(r=>r.changed)).toHaveLength(1);
      expect((await adapter.reviewPayment(id,paymentId,'approve',context)).replayed).toBe(true);
      expect((await adapter.reviewPayment(id,paymentId,'approve',ctx('Repeat decision'))).changed).toBe(false);
      expect((await adapter.getTenant(id))?.subscription).toMatchObject({plan_code:'free',status:'active',current_period_end:null});
      expect(await count("SELECT count(*) n FROM subscription_payment WHERE id=$1 AND status='verified'",[paymentId])).toBe(1);
      expect(await count("SELECT count(*) n FROM outbox_event WHERE tenant_id=$1 AND event_type='subscription.payment_reviewed'",[id])).toBe(1);
      expect(await count("SELECT count(*) n FROM audit_event WHERE tenant_id=$1 AND action='operator.subscription.payment.approve' AND redacted_summary->>'activation_pending'='true'",[id])).toBe(1);
    });
    it('rolls back a mismatched upgrade price without reviewing or queuing it', async () => {
      const id=freeIds[1]!,paymentId=await upgradePayment(id,true);
      await expect(adapter.reviewPayment(id,paymentId,'approve',ctx('Invalid synthetic price'))).rejects.toMatchObject({status:409});
      expect(await count("SELECT count(*) n FROM subscription_payment WHERE id=$1 AND status='pending' AND reviewed_at IS NULL",[paymentId])).toBe(1);
      expect(await count("SELECT count(*) n FROM outbox_event WHERE tenant_id=$1 AND event_type='subscription.payment_reviewed'",[id])).toBe(0);
    });
  });
});
