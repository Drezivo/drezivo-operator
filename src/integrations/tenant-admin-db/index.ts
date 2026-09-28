import pg from 'pg';
import { AppError } from '../../errors.js';
import type {
  CommandContext,
  CommandResult,
  PersonRow,
  TenantAdminPort,
  TenantAuditEntry,
  TenantDetail,
  TenantMember,
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

const TENANT_LIST_LIMIT = 200;
const AUDIT_LIMIT = 20;

const conflict = (message: string) => new AppError(409, 'STATE_CONFLICT', message);
const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);
const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** `caCertificate` (PEM) enables verified TLS; production config refuses to start without it. */
export type TenantAdminDbOptions = { connectionString: string; caCertificate?: string };

export function createTenantAdminDbAdapter(options: TenantAdminDbOptions): TenantAdminPort & { close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: 3,
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
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.principal_id', actorKey]);
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

  async function allTenants(): Promise<TenantRow[]> {
    const client = await pool.connect();
    try {
      await verifyRole(client);
      // `tenant` is a global table (no tenant RLS); tenant-owned rows are read per tenant under RLS.
      const result = await client.query<TenantRow>(
        `SELECT id, name, slug, status, timezone, created_at FROM tenant ORDER BY created_at DESC LIMIT ${TENANT_LIST_LIMIT}`,
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  return {
    async listPeople() {
      const people: PersonRow[] = [];
      for (const tenant of await allTenants()) {
        const rows = await transaction(tenant.id, 'operator:list', async (client) => (await client.query<{
          id: string; clerk_user_id: string; role: PersonRow['role']; status: PersonRow['status']; created_at: Date;
        }>('SELECT id, clerk_user_id, role, status, created_at FROM membership WHERE tenant_id = $1 ORDER BY role, created_at', [tenant.id])).rows);
        for (const row of rows) {
          people.push({
            tenant_id: tenant.id, tenant_name: tenant.name, tenant_status: tenant.status, membership_id: row.id,
            clerk_user_id: row.clerk_user_id, role: row.role, status: row.status, created_at: row.created_at.toISOString(),
          });
        }
      }
      return people;
    },

    async listTenants() {
      const tenants = await allTenants();
      const summaries: TenantSummary[] = [];
      for (const tenant of tenants) {
        summaries.push(await transaction(tenant.id, 'operator:list', (client) => summaryOf(client, tenant)));
      }
      return summaries;
    },

    async getTenant(tenantId) {
      return transaction(tenantId, 'operator:read', async (client) => {
        const tenant = await tenantRow(client, tenantId);
        return tenant ? detailOf(client, tenant) : null;
      });
    },

    async updateProfile(tenantId, change, ctx) {
      return command(tenantId, 'tenant.profile.update', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const result = await client.query(
          `UPDATE tenant
              SET name = COALESCE($2, name), timezone = COALESCE($3, timezone), updated_at = now()
            WHERE id = $1
              AND (name IS DISTINCT FROM COALESCE($2, name) OR timezone IS DISTINCT FROM COALESCE($3, timezone))`,
          [tenantId, change.name ?? null, change.timezone ?? null],
        );
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

    close: () => pool.end(),
  };
}
