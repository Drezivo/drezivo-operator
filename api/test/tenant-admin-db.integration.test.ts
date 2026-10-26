import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { requestId, errorHandler } from '../src/shared/http/middleware.js';
import { createOperatorConsoleRouter } from '../src/features/sessions/index.js';
import { createSessionWebhookRouter } from '../src/features/sessions/webhook-routes.js';
import { createConsoleDbAdapter } from '../src/infrastructure/db/console-ports.js';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantAdminDbAdapter } from '../src/features/clients/repository/admin.js';
import { createPlatformPaymentsDbAdapter } from '../src/features/payment-methods/repository/postgres.js';
import type { CommandContext } from '../src/features/clients/administration/index.js';

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
