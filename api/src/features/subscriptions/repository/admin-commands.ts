import type pg from 'pg';
import type { TenantAdminPort } from '../../clients/administration/index.js';
import { notFound, type TenantAdminDbContext } from '../../../infrastructure/db/tenant-admin-context.js';

export function createSubscriptionAdminCommandAdapter(context: TenantAdminDbContext): Pick<TenantAdminPort, 'setTrialEnd' | 'activateSubscription' | 'extendReadOnly'> {
  const { command, tenantRow, subscriptionOf, liftLifecycleRestriction, conflict } = context;
  return {
    async setTrialEnd(tenantId, trialEndsAt, ctx) {
      return command(tenantId, 'subscription.trial.set_end', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        const subscription = await subscriptionOf(client, tenantId, true);
        if (!subscription) throw conflict('The business has no subscription.');
        if (subscription.plan_code === 'free') throw conflict('Free plans do not have paid or trial dates. Use the business upgrade workflow.');
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
        if (subscription.plan_code === 'free') throw conflict('Free plans do not have paid or trial dates. Use the business upgrade workflow.');
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
        if (subscription.plan_code === 'free') throw conflict('Free plans do not have expiring read-only periods.');
        // grace_ends_at is the pilot's "view-only until" date (business migration 0063).
        const result = await client.query(
          'UPDATE subscription SET grace_ends_at = $2 WHERE id = $1 AND grace_ends_at IS DISTINCT FROM $2',
          [subscription.id, readOnlyUntil],
        );
        return { changed: result.rowCount === 1, summary: { read_only_until: readOnlyUntil.toISOString(), status: subscription.status } };
      });
    },
  };
}
