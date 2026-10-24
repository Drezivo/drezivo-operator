import pg from 'pg';
import { AppError } from '../../shared/http/errors.js';
import type { CommandContext, CommandResult, SubscriptionPaymentRow, TenantDetail, TenantMember, TenantNote, TenantSummary } from '../../features/clients/administration/index.js';

type Queryable = Pick<pg.PoolClient, 'query'>;
type TenantRow = { id: string; name: string; slug: string; status: TenantSummary['status']; timezone: string; created_at: Date };
type SubscriptionRow = {
  id: string; plan_id: string; status: NonNullable<TenantSummary['subscription']>['status']; plan_code: string;
  trial_ends_at: Date | null; grace_ends_at: Date | null; current_period_end: Date | null;
};
type Applied = { changed: boolean; summary: Record<string, unknown> };

// Caps for the cross-tenant lists (business migration 0069 enforces the same upper bounds).
const TENANT_LIST_LIMIT = 1000;
const PEOPLE_LIST_LIMIT = 5000;
const NOTE_LIMIT = 50;
const TENANT_PAYMENT_LIMIT = 20;
const PAYMENT_QUEUE_LIMIT = 200;

export type PaymentDbRow = {
  target_plan_code?: string | null;
  id: string; tenant_id: string; status: SubscriptionPaymentRow['status']; amount_minor: number; currency: string;
  reference: string | null; method_label: string | null; created_at: Date; reviewed_at: Date | null;
  reviewed_by: string | null; review_note: string | null; has_proof: boolean;
};
const PAYMENT_COLUMNS = `sp.id, sp.tenant_id, sp.status, sp.amount_minor, sp.currency, sp.reference,
  target_plan.code AS target_plan_code, ppm.label AS method_label, sp.created_at, sp.reviewed_at, sp.reviewed_by, sp.review_note,
  (sp.proof_file_id IS NOT NULL) AS has_proof`;
const PAYMENT_FROM = `FROM subscription_payment sp
  LEFT JOIN platform_payment_method ppm ON ppm.id = sp.payment_method_id
  LEFT JOIN plan target_plan ON target_plan.id = sp.target_plan_id`;
export const paymentOf = (row: PaymentDbRow, tenantName: string): SubscriptionPaymentRow => ({
  payment_id: row.id, tenant_id: row.tenant_id, tenant_name: tenantName, status: row.status,
  amount_minor: String(row.amount_minor), currency: row.currency, reference: row.reference, method_label: row.method_label,
  submitted_at: row.created_at.toISOString(), reviewed_at: iso(row.reviewed_at), reviewed_by: row.reviewed_by,
  review_note: row.review_note, has_proof: row.has_proof, target_plan_code: row.target_plan_code ?? null,
});

export const conflict = (message: string) => new AppError(409, 'STATE_CONFLICT', message);
export const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);
export const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** `caCertificate` (PEM) enables verified TLS; production config refuses to start without it. */
export type TenantAdminDbOptions = { connectionString: string; caCertificate?: string };

export function createTenantAdminDbContext(options: TenantAdminDbOptions) {

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
        current_period_end: iso(subscription.current_period_end),
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
    return {
      ...(await summaryOf(client, tenant)),
      members: members.rows.map((row) => ({
        membership_id: row.id, clerk_user_id: row.clerk_user_id, role: row.role, status: row.status, created_at: row.created_at.toISOString(),
      })),
      recent_audit: [],
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
    const fingerprint = ctx.requestFingerprint ?? null;
    return transaction(tenantId, actorKey, async (client) => {
      const tenant = await tenantRow(client, tenantId, true);
      if (!tenant) throw notFound('The business was not found.');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO operator_command
           (tenant_id, operator_subject, command_kind, resource_kind, resource_id, intent_key, reason, status, request_id, accepted_at, completed_at, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, now(), now(), $9)
         ON CONFLICT ON CONSTRAINT operator_command_tenant_subject_kind_intent_key DO NOTHING
         RETURNING id`,
        [tenantId, ctx.operatorSubject, kind, resource.kind, resource.id, ctx.idempotencyKey, ctx.reason, ctx.requestId, fingerprint],
      );
      const commandId = inserted.rows[0]?.id;
      if (!commandId) {
        const previous = await client.query<{ resource_id: string; request_fingerprint: string | null }>(
          'SELECT resource_id, request_fingerprint FROM operator_command WHERE tenant_id=$1 AND operator_subject=$2 AND command_kind=$3 AND intent_key=$4',
          [tenantId, ctx.operatorSubject, kind, ctx.idempotencyKey],
        );
        if (previous.rows[0]?.resource_id !== resource.id || previous.rows[0]?.request_fingerprint !== fingerprint) throw conflict('This idempotency key belongs to another request.');
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
    transaction, subscriptionOf, summaryOf, tenantRow, detailOf, liftLifecycleRestriction, command, operatorRead,
    close: () => pool.end(),
    TENANT_LIST_LIMIT, PEOPLE_LIST_LIMIT, PAYMENT_QUEUE_LIMIT,
    paymentOf, conflict, notFound, iso,
  };
}

export type TenantAdminDbContext = ReturnType<typeof createTenantAdminDbContext>;
