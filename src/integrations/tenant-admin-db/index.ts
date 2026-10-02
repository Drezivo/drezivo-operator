import pg from 'pg';
import { AppError } from '../../errors.js';
import type {
  CommandContext,
  CommandResult,
  PersonRow,
  SubscriptionPaymentRow,
  TenantAdminPort,
  TenantAuditEntry,
  TenantDetail,
  TenantMember,
  TenantNote,
  TenantSummary,
} from '../../operator-tenant-admin/index.js';

/**
 * Direct business-database adapter for client administration (ADR 0025).
 *
 * Connects as the business runtime role (`drezivo_app`): no table ownership, no BYPASSRLS. Every
 * tenant read or write runs inside a transaction that sets `app.tenant_id` with `set_config(…, true)`,
 * so the business database's own row-level security decides what is visible — exactly like the
 * business API. Mutations record an `operator_command` row keyed by the Idempotency-Key and an
 * `audit_event` row in the same transaction, so a retried or double-fired request replays.
 */

type Queryable = Pick<pg.PoolClient, 'query'>;
type TenantRow = { id: string; name: string; slug: string; status: TenantSummary['status']; timezone: string; created_at: Date };
type SubscriptionRow = {
  id: string; plan_id: string; status: NonNullable<TenantSummary['subscription']>['status']; plan_code: string;
  trial_ends_at: Date | null; grace_ends_at: Date | null; current_period_end: Date;
};
type Applied = { changed: boolean; summary: Record<string, unknown> };

// Caps for the cross-tenant lists (business migration 0069 enforces the same upper bounds).
const TENANT_LIST_LIMIT = 1000;
const PEOPLE_LIST_LIMIT = 5000;
const AUDIT_LIMIT = 20;
const NOTE_LIMIT = 50;
const TENANT_PAYMENT_LIMIT = 20;
const PAYMENT_QUEUE_LIMIT = 200;

type PaymentDbRow = {
  id: string; tenant_id: string; status: SubscriptionPaymentRow['status']; amount_minor: number; currency: string;
  reference: string | null; method_label: string | null; created_at: Date; reviewed_at: Date | null;
  reviewed_by: string | null; review_note: string | null; has_proof: boolean;
};
const PAYMENT_COLUMNS = `sp.id, sp.tenant_id, sp.status, sp.amount_minor, sp.currency, sp.reference,
  ppm.label AS method_label, sp.created_at, sp.reviewed_at, sp.reviewed_by, sp.review_note,
  (sp.proof_file_id IS NOT NULL) AS has_proof`;
const PAYMENT_FROM = `FROM subscription_payment sp
  LEFT JOIN platform_payment_method ppm ON ppm.id = sp.payment_method_id`;
const paymentOf = (row: PaymentDbRow, tenantName: string): SubscriptionPaymentRow => ({
  payment_id: row.id, tenant_id: row.tenant_id, tenant_name: tenantName, status: row.status,
  amount_minor: String(row.amount_minor), currency: row.currency, reference: row.reference, method_label: row.method_label,
  submitted_at: row.created_at.toISOString(), reviewed_at: iso(row.reviewed_at), reviewed_by: row.reviewed_by,
  review_note: row.review_note, has_proof: row.has_proof,
});

const conflict = (message: string) => new AppError(409, 'STATE_CONFLICT', message);
const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);
const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** `caCertificate` (PEM) enables verified TLS; production config refuses to start without it. */
export type TenantAdminDbOptions = { connectionString: string; caCertificate?: string };

export function createTenantAdminDbAdapter(options: TenantAdminDbOptions): TenantAdminPort & { close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    // Lists are one query each now; a few more connections let detail pages and actions overlap.
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(options.caCertificate ? { ssl: { ca: options.caCertificate, rejectUnauthorized: true } } : {}),
  });
  let roleVerified = false;

  /** Fails closed if the configured login could bypass row-level security. */
  async function verifyRole(client: Queryable): Promise<void> {
    if (roleVerified) return;
    const result = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    const role = result.rows[0];
    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is misconfigured: the database role must not bypass row-level security.');
    }
    roleVerified = true;
  }

  async function transaction<T>(tenantId: string, actorKey: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await verifyRole(client);
      await client.query('BEGIN');
      // One round trip for every transaction-local setting (set_config(..., true) = SET LOCAL).
      await client.query(
        `SELECT set_config('statement_timeout', '5s', true), set_config('lock_timeout', '3s', true),
                set_config('app.tenant_id', $1, true), set_config('app.principal_id', $2, true)`,
        [tenantId, actorKey],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function subscriptionOf(client: Queryable, tenantId: string, forUpdate = false): Promise<SubscriptionRow | null> {
    const result = await client.query<SubscriptionRow>(
      `SELECT s.id, s.plan_id, s.status, p.code AS plan_code, s.trial_ends_at, s.grace_ends_at, s.current_period_end
         FROM subscription s JOIN plan p ON p.id = s.plan_id
        WHERE s.tenant_id = $1
        ORDER BY s.created_at DESC
        LIMIT 1${forUpdate ? ' FOR UPDATE OF s' : ''}`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  }

  async function summaryOf(client: Queryable, tenant: TenantRow): Promise<TenantSummary> {
    const subscription = await subscriptionOf(client, tenant.id);
    const counts = await client.query<{ status: TenantMember['status']; count: number }>(
      'SELECT status, count(*)::int AS count FROM membership WHERE tenant_id = $1 GROUP BY status',
      [tenant.id],
    );
    const member_counts = { active: 0, suspended: 0, removed: 0 };
    for (const row of counts.rows) member_counts[row.status] = row.count;
    const pending = await client.query<{ pending: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM subscription_payment WHERE tenant_id = $1 AND status = 'pending') AS pending",
      [tenant.id],
    );
    return {
      tenant_id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      timezone: tenant.timezone,
      created_at: tenant.created_at.toISOString(),
      subscription: subscription ? {
        status: subscription.status,
        plan_code: subscription.plan_code,
        trial_ends_at: iso(subscription.trial_ends_at),
        grace_ends_at: iso(subscription.grace_ends_at),
        current_period_end: subscription.current_period_end.toISOString(),
      } : null,
      member_counts,
      pending_payment: pending.rows[0]?.pending === true,
    };
  }

  async function tenantRow(client: Queryable, tenantId: string, forUpdate = false): Promise<TenantRow | null> {
    const result = await client.query<TenantRow>(
      `SELECT id, name, slug, status, timezone, created_at FROM tenant WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId],
    );
    return result.rows[0] ?? null;
  }

  async function detailOf(client: Queryable, tenant: TenantRow): Promise<TenantDetail> {
    const members = await client.query<{ id: string; clerk_user_id: string; role: TenantMember['role']; status: TenantMember['status']; created_at: Date }>(
      `SELECT id, clerk_user_id, role, status, created_at FROM membership
        WHERE tenant_id = $1 ORDER BY role, created_at`,
      [tenant.id],
    );
    const audit = await client.query<{ occurred_at: Date; actor_kind: string; action: string; entity_type: string; outcome: string }>(
      `SELECT occurred_at, actor_kind, action, entity_type, outcome FROM audit_event
        WHERE tenant_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT ${AUDIT_LIMIT}`,
      [tenant.id],
    );
    return {
      ...(await summaryOf(client, tenant)),
      members: members.rows.map((row) => ({
        membership_id: row.id, clerk_user_id: row.clerk_user_id, role: row.role, status: row.status, created_at: row.created_at.toISOString(),
      })),
      recent_audit: audit.rows.map((row): TenantAuditEntry => ({
        occurred_at: row.occurred_at.toISOString(), actor_kind: row.actor_kind, action: row.action, entity_type: row.entity_type, outcome: row.outcome,
      })),
      notes: (await client.query<{ id: string; body: string; author_label: string; created_at: Date }>(
        `SELECT id, body, author_label, created_at FROM tenant_operator_note
          WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${NOTE_LIMIT}`,
        [tenant.id],
      )).rows.map((row): TenantNote => ({ id: row.id, body: row.body, author_label: row.author_label, created_at: row.created_at.toISOString() })),
      payments: (await client.query<PaymentDbRow>(
        `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM} WHERE sp.tenant_id = $1 ORDER BY sp.created_at DESC, sp.id DESC LIMIT ${TENANT_PAYMENT_LIMIT}`,
        [tenant.id],
      )).rows.map((row) => paymentOf(row, tenant.name)),
    };
  }

  /** Lifts a lifecycle restriction (subscription and tenant both restricted) but never a manual operator lock. */
  async function liftLifecycleRestriction(client: Queryable, tenantId: string, priorSubscriptionStatus: string): Promise<boolean> {
    if (priorSubscriptionStatus !== 'restricted') return false;
    const result = await client.query(
      "UPDATE tenant SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'restricted'",
      [tenantId],
    );
    return result.rowCount === 1;
  }

  /**
   * Runs one operator command exactly once per (tenant, operator, kind, idempotency key). The tenant
   * row lock serializes commands on the same business; the unique intent key turns a duplicate into
   * a replay that returns current state without applying anything again.
   */
  async function command(
    tenantId: string,
    kind: string,
    resource: { kind: string; id: string },
    ctx: CommandContext,
    apply: (client: pg.PoolClient) => Promise<Applied>,
  ): Promise<CommandResult> {
    const actorKey = `operator:${ctx.operatorSubject}`;
    return transaction(tenantId, actorKey, async (client) => {
      const tenant = await tenantRow(client, tenantId, true);
      if (!tenant) throw notFound('The business was not found.');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO operator_command
           (tenant_id, operator_subject, command_kind, resource_kind, resource_id, intent_key, reason, status, request_id, accepted_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, now(), now())
         ON CONFLICT ON CONSTRAINT operator_command_tenant_subject_kind_intent_key DO NOTHING
         RETURNING id`,
        [tenantId, ctx.operatorSubject, kind, resource.kind, resource.id, ctx.idempotencyKey, ctx.reason, ctx.requestId],
      );
      const commandId = inserted.rows[0]?.id;
      if (!commandId) {
        const current = await tenantRow(client, tenantId);
        return { tenant: await detailOf(client, current ?? tenant), changed: false, replayed: true };
      }
      const applied = await apply(client);
      await client.query(
        `INSERT INTO audit_event
           (tenant_id, actor_kind, actor_key, operator_command_id, action, entity_type, entity_id, redacted_summary, request_id, occurred_at, outcome)
         VALUES ($1, 'operator', $2, $3, $4, $5, $6, $7::jsonb, $8, now(), 'succeeded')`,
        [tenantId, actorKey, commandId, `operator.${kind}`, resource.kind, resource.id,
          JSON.stringify({ ...applied.summary, changed: applied.changed }), ctx.requestId],
      );
      const current = await tenantRow(client, tenantId);
      return { tenant: await detailOf(client, current ?? tenant), changed: applied.changed, replayed: false };
    });
  }

  /**
   * Cross-tenant operator lists. Each is ONE call to a read-only SECURITY DEFINER function from
   * business migration 0069, which answers only inside this explicit operator context (no tenant
   * set), so a list costs a handful of round trips instead of a transaction per business.
   */
  async function operatorRead<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await verifyRole(client);
      await client.query('BEGIN READ ONLY');
      await client.query(
        `SELECT set_config('statement_timeout', '5s', true), set_config('app.actor_kind', 'operator', true),
                set_config('app.principal_id', 'operator:list', true), set_config('app.tenant_id', '', true)`,
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async listPeople() {
      const rows = await operatorRead(async (client) => (await client.query<{
        tenant_id: string; tenant_name: string; tenant_status: PersonRow['tenant_status']; membership_id: string;
        clerk_user_id: string; role: PersonRow['role']; status: PersonRow['status']; created_at: Date;
      }>('SELECT * FROM operator_people($1)', [PEOPLE_LIST_LIMIT])).rows);
      return rows.map((row): PersonRow => ({
        tenant_id: row.tenant_id, tenant_name: row.tenant_name, tenant_status: row.tenant_status, membership_id: row.membership_id,
        clerk_user_id: row.clerk_user_id, role: row.role, status: row.status, created_at: row.created_at.toISOString(),
      }));
    },

    async listTenants() {
      const rows = await operatorRead(async (client) => (await client.query<{
        tenant_id: string; name: string; slug: string; status: TenantSummary['status']; timezone: string; created_at: Date;
        subscription_status: NonNullable<TenantSummary['subscription']>['status'] | null; plan_code: string | null;
        trial_ends_at: Date | null; grace_ends_at: Date | null; current_period_end: Date | null;
        members_active: number; members_suspended: number; members_removed: number; pending_payment: boolean;
      }>('SELECT * FROM operator_tenant_summaries($1)', [TENANT_LIST_LIMIT])).rows);
      return rows.map((row): TenantSummary => ({
        tenant_id: row.tenant_id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        timezone: row.timezone,
        created_at: row.created_at.toISOString(),
        subscription: row.subscription_status && row.plan_code && row.current_period_end ? {
          status: row.subscription_status,
          plan_code: row.plan_code,
          trial_ends_at: iso(row.trial_ends_at),
          grace_ends_at: iso(row.grace_ends_at),
          current_period_end: row.current_period_end.toISOString(),
        } : null,
        member_counts: { active: row.members_active, suspended: row.members_suspended, removed: row.members_removed },
        pending_payment: row.pending_payment,
      }));
    },

    async getTenant(tenantId) {
      return transaction(tenantId, 'operator:read', async (client) => {
        const tenant = await tenantRow(client, tenantId);
        return tenant ? detailOf(client, tenant) : null;
      });
    },

    async updateProfile(tenantId, change, ctx) {
      return command(tenantId, 'tenant.profile.update', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        // Touch only the requested columns: business migration 0064 grants drezivo_app UPDATE on
        // tenant (name, status, updated_at), so writing timezone back unchanged was itself refused.
        const params: unknown[] = [tenantId];
        const sets: string[] = [];
        const differs: string[] = [];
        for (const column of ['name', 'timezone'] as const) {
          const value = change[column];
          if (value === undefined) continue;
          params.push(value);
          sets.push(`${column} = $${params.length}`);
          differs.push(`${column} IS DISTINCT FROM $${params.length}`);
        }
        let result: pg.QueryResult;
        try {
          result = await client.query(
            `UPDATE tenant SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND (${differs.join(' OR ')})`,
            params,
          );
        } catch (error) {
          if ((error as { code?: string }).code === '42501' && change.timezone !== undefined) {
            throw conflict('Changing the time zone is not available yet. Renaming the business still works.');
          }
          throw error;
        }
        return { changed: result.rowCount === 1, summary: { fields: Object.keys(change) } };
      });
    },

    async setTenantLocked(tenantId, locked, ctx) {
      return command(tenantId, locked ? 'tenant.lock' : 'tenant.unlock', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const tenant = await tenantRow(client, tenantId);
        if (tenant?.status === 'cancelled') throw conflict('A cancelled business cannot be locked or unlocked.');
        if (!locked) {
          const subscription = await subscriptionOf(client, tenantId);
          if (subscription && (subscription.status === 'restricted' || subscription.status === 'cancelled')) {
            throw conflict('The subscription is restricted. Extend the trial or activate the subscription instead of unlocking.');
          }
        }
        const result = await client.query(
          `UPDATE tenant SET status = $2, updated_at = now() WHERE id = $1 AND status = $3`,
          [tenantId, locked ? 'restricted' : 'active', locked ? 'active' : 'restricted'],
        );
        return { changed: result.rowCount === 1, summary: { next_status: locked ? 'restricted' : 'active' } };
      });
    },

    async setMemberSuspended(tenantId, membershipId, suspended, ctx) {
      return command(tenantId, suspended ? 'membership.suspend' : 'membership.reactivate', { kind: 'membership', id: membershipId }, ctx, async (client) => {
        const result = await client.query(
          `UPDATE membership
              SET status = $3, authz_version = authz_version + 1, updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = $4`,
          [membershipId, tenantId, suspended ? 'suspended' : 'active', suspended ? 'active' : 'suspended'],
        );
        if (result.rowCount === 0) {
          const existing = await client.query<{ status: string }>('SELECT status FROM membership WHERE id = $1 AND tenant_id = $2', [membershipId, tenantId]);
          const status = existing.rows[0]?.status;
          if (!status) throw notFound('The member was not found in this business.');
          if (status === 'removed') throw conflict('A removed member cannot be suspended or reactivated.');
        }
        return { changed: result.rowCount === 1, summary: { next_status: suspended ? 'suspended' : 'active' } };
      });
    },

    async setTrialEnd(tenantId, trialEndsAt, ctx) {
      return command(tenantId, 'subscription.trial.set_end', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const subscription = await subscriptionOf(client, tenantId, true);
        if (!subscription) throw conflict('The business has no subscription.');
        if (subscription.status === 'active') throw conflict('The subscription is already paid; the trial end no longer applies.');
        if (subscription.status === 'cancelled') throw conflict('A cancelled subscription cannot get a new trial end.');
        const result = await client.query(
          `UPDATE subscription
              SET status = 'trialing', trial_ends_at = $2, current_period_end = $2, grace_ends_at = NULL
            WHERE id = $1 AND (status <> 'trialing' OR trial_ends_at IS DISTINCT FROM $2)`,
          [subscription.id, trialEndsAt],
        );
        const tenantUnlocked = result.rowCount === 1 && await liftLifecycleRestriction(client, tenantId, subscription.status);
        return {
          changed: result.rowCount === 1,
          summary: { prior_status: subscription.status, trial_ends_at: trialEndsAt.toISOString(), tenant_unlocked: tenantUnlocked },
        };
      });
    },

    async activateSubscription(tenantId, currentPeriodEnd, ctx) {
      return command(tenantId, 'subscription.activate', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const subscription = await subscriptionOf(client, tenantId, true);
        if (!subscription) throw conflict('The business has no subscription.');
        if (subscription.status === 'cancelled') throw conflict('A cancelled subscription cannot be activated here.');
        const wasActive = subscription.status === 'active';
        const result = await client.query(
          `UPDATE subscription
              SET status = 'active',
                  current_period_start = CASE WHEN status = 'active' THEN current_period_start ELSE now() END,
                  current_period_end = $2,
                  grace_ends_at = NULL
            WHERE id = $1 AND (status <> 'active' OR current_period_end IS DISTINCT FROM $2)`,
          [subscription.id, currentPeriodEnd],
        );
        const changed = result.rowCount === 1;
        if (changed) {
          await client.query(
            `INSERT INTO subscription_event (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
             VALUES ($1, $2, $3, $3, $4, now(), $5)`,
            [tenantId, subscription.id, subscription.plan_id, wasActive ? 'renewed' : 'converted', `operator:${ctx.operatorSubject}:${ctx.idempotencyKey}`],
          );
        }
        const tenantUnlocked = changed && await liftLifecycleRestriction(client, tenantId, subscription.status);
        return {
          changed,
          summary: { prior_status: subscription.status, current_period_end: currentPeriodEnd.toISOString(), tenant_unlocked: tenantUnlocked },
        };
      });
    },

    async extendReadOnly(tenantId, readOnlyUntil, ctx) {
      return command(tenantId, 'subscription.read_only.extend', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const subscription = await subscriptionOf(client, tenantId, true);
        if (!subscription) throw conflict('The business has no subscription.');
        if (subscription.status === 'cancelled') throw conflict('A cancelled subscription cannot be extended.');
        // grace_ends_at is the pilot's "view-only until" date (business migration 0063).
        const result = await client.query(
          'UPDATE subscription SET grace_ends_at = $2 WHERE id = $1 AND grace_ends_at IS DISTINCT FROM $2',
          [subscription.id, readOnlyUntil],
        );
        return { changed: result.rowCount === 1, summary: { read_only_until: readOnlyUntil.toISOString(), status: subscription.status } };
      });
    },

    async addNote(tenantId, body, authorLabel, ctx) {
      return command(tenantId, 'tenant.note.add', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        await client.query('INSERT INTO tenant_operator_note (tenant_id, body, author_label) VALUES ($1, $2, $3)', [tenantId, body, authorLabel]);
        // The note text stays out of the audit summary.
        return { changed: true, summary: { note_length: body.length } };
      });
    },

    async listPayments(filter) {
      // Oldest pending first so nobody waits longest; recent history newest first (ordered in SQL).
      const rows = await operatorRead(async (client) => (await client.query<PaymentDbRow & { payment_id: string; tenant_name: string }>(
        'SELECT * FROM operator_subscription_payment_queue($1, $2)',
        [filter, PAYMENT_QUEUE_LIMIT],
      )).rows);
      return rows.map((row) => paymentOf({ ...row, id: row.payment_id }, row.tenant_name));
    },

    async reviewPayment(tenantId, paymentId, decision, ctx) {
      return command(tenantId, `subscription.payment.${decision}`, { kind: 'subscription_payment', id: paymentId }, ctx, async (client) => {
        const found = await client.query<{ status: SubscriptionPaymentRow['status']; subscription_id: string }>(
          'SELECT status, subscription_id FROM subscription_payment WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenantId, paymentId],
        );
        const payment = found.rows[0];
        if (!payment) throw notFound('The payment was not found in this business.');
        const target = decision === 'approve' ? 'verified' : 'failed';
        if (payment.status === target) return { changed: false, summary: { decision, payment_id: paymentId } };
        if (payment.status !== 'pending') throw conflict('This payment was already reviewed.');

        await client.query(
          `UPDATE subscription_payment
              SET status = $3, reviewed_at = now(), reviewed_by = $4, review_note = $5
            WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
          [tenantId, paymentId, target, ctx.operatorSubject, decision === 'reject' ? ctx.reason.slice(0, 500) : null],
        );

        let summary: Record<string, unknown> = { decision, payment_id: paymentId };
        if (decision === 'approve') {
          const subscription = await subscriptionOf(client, tenantId, true);
          if (!subscription) throw conflict('The business has no subscription.');
          if (subscription.status === 'cancelled') throw conflict('A cancelled subscription cannot be activated here.');
          // One more month from the later of now, the trial end, or the current paid-through date.
          const updated = await client.query<{ current_period_end: Date }>(
            `UPDATE subscription
                SET current_period_start = CASE WHEN status = 'active' AND current_period_end > now() THEN current_period_start ELSE now() END,
                    current_period_end = GREATEST(
                      now(),
                      CASE WHEN status = 'trialing' THEN COALESCE(trial_ends_at, now()) ELSE now() END,
                      CASE WHEN status = 'active' THEN current_period_end ELSE now() END
                    ) + interval '1 month',
                    status = 'active',
                    grace_ends_at = NULL
              WHERE id = $1
              RETURNING current_period_end`,
            [subscription.id],
          );
          await client.query(
            `INSERT INTO subscription_event (tenant_id, subscription_id, prior_plan_id, next_plan_id, event_type, effective_at, business_key)
             VALUES ($1, $2, $3, $3, $4, now(), $5)
             ON CONFLICT (tenant_id, business_key) DO NOTHING`,
            [tenantId, subscription.id, subscription.plan_id, subscription.status === 'active' ? 'renewed' : 'converted', `payment:${paymentId}`],
          );
          await liftLifecycleRestriction(client, tenantId, subscription.status);
          summary = { ...summary, current_period_end: updated.rows[0]?.current_period_end.toISOString() ?? null };
        }

        // The business worker composes and sends the owner's email (this API cannot seal emails).
        const outcome = decision === 'approve' ? 'approved' : 'rejected';
        await client.query(
          `INSERT INTO outbox_event (tenant_id, dedupe_key, event_type, payload)
           VALUES ($1, $2, 'subscription.payment_reviewed', $3::jsonb)
           ON CONFLICT DO NOTHING`,
          [tenantId, `subscription.payment_reviewed:${paymentId}:${outcome}`, JSON.stringify({ payment_id: paymentId, outcome })],
        );
        return { changed: true, summary };
      });
    },

    close: () => pool.end(),
  };
}
