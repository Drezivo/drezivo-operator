import { z } from 'zod';
import pg from 'pg';
import type { SubscriptionPaymentRow, TenantAdminPort } from '../../clients/administration/index.js';
import type { PaymentDbRow, TenantAdminDbContext } from '../../../infrastructure/db/tenant-admin-context.js';

export function createTenantPaymentAdapter(context: TenantAdminDbContext): Pick<TenantAdminPort, 'listPayments' | 'reviewPayment'> {
  const { operatorRead, command, subscriptionOf, liftLifecycleRestriction, conflict, notFound, paymentOf, PAYMENT_QUEUE_LIMIT } = context;
  return {
    async listPayments(filter) {
      // Oldest pending first so nobody waits longest; recent history newest first (ordered in SQL).
      const rows = await operatorRead(async (client) => {
        const queue = (await client.query<PaymentDbRow & { payment_id: string; tenant_name: string }>('SELECT * FROM operator_subscription_payment_queue($1,$2)',[filter,PAYMENT_QUEUE_LIMIT])).rows;
        const metadata = (await client.query<{data:unknown}>("SELECT operator_console_projection('payment-targets',$1::jsonb) AS data",[JSON.stringify({ids:queue.map(row=>row.payment_id)})])).rows[0]?.data;
        const targets = z.array(z.object({payment_id:z.string().uuid(),target_plan_code:z.string().nullable()}).strict()).max(PAYMENT_QUEUE_LIMIT).parse(metadata);
        const byId = new Map(targets.map(row=>[row.payment_id,row.target_plan_code]));
        return queue.map(row=>({...row,target_plan_code:byId.get(row.payment_id)??null}));
      });
      return rows.map((row) => paymentOf({ ...row, id: row.payment_id }, row.tenant_name));
    },

    async reviewPayment(tenantId, paymentId, decision, ctx) {
      return command(tenantId, `subscription.payment.${decision}`, { kind: 'subscription_payment', id: paymentId }, ctx, async (client) => {
        const found = await client.query<{ status: SubscriptionPaymentRow['status']; subscription_id: string; amount_minor: number; currency: string; submitted_by_membership_id: string|null; target_plan_id: string|null }>(
          'SELECT status, subscription_id, amount_minor, currency, submitted_by_membership_id, target_plan_id FROM subscription_payment WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenantId, paymentId],
        );
        const payment = found.rows[0];
        if (!payment) throw notFound('The payment was not found in this business.');
        const target = decision === 'approve' ? 'verified' : 'failed';
        if (payment.status === target) return { changed: false, summary: { decision, payment_id: paymentId } };
        if (payment.status !== 'pending') throw conflict('This payment was already reviewed.');

        const reviewed = await client.query<{reviewed_at:Date}>(
          `UPDATE subscription_payment
              SET status = $3, reviewed_at = now(), reviewed_by = $4, review_note = $5
            WHERE tenant_id = $1 AND id = $2 AND status = 'pending' RETURNING reviewed_at`,
          [tenantId, paymentId, target, ctx.operatorSubject, decision === 'reject' ? ctx.reason.slice(0, 500) : null],
        );

        let summary: Record<string, unknown> = { decision, payment_id: paymentId, amount_minor:String(payment.amount_minor),currency:payment.currency,payer_key:payment.submitted_by_membership_id?`membership:${payment.submitted_by_membership_id}`:null,paid_at:decision==='approve'?reviewed.rows[0]?.reviewed_at.toISOString()??null:null };
        if (decision === 'approve') {
          const subscription = await subscriptionOf(client, tenantId, true);
          if (!subscription) throw conflict('The business has no subscription.');
          if (subscription.status === 'cancelled') throw conflict('A cancelled subscription cannot be activated here.');
          if (payment.subscription_id !== subscription.id) throw conflict('The payment belongs to a different subscription.');
          const price = (await client.query<{id:string;code:string;monthly_minor:number;currency:string;active:boolean}>(
            'SELECT id,code,monthly_minor,currency,active FROM plan WHERE id=$1', [payment.target_plan_id ?? subscription.plan_id],
          )).rows[0];
          if (!price || !price.active || !['starter','standard'].includes(price.code) || price.monthly_minor <= 0 || payment.amount_minor !== price.monthly_minor || payment.currency !== price.currency) throw conflict('The payment does not match its server-recorded plan price.');
          if (subscription.plan_code !== 'free' && price.id !== subscription.plan_id) throw conflict('Paid plan changes must use the business upgrade workflow.');
          if (subscription.plan_code === 'free') {
            const workspace = (await client.query<{status:string}>('SELECT status FROM tenant WHERE id=$1',[tenantId])).rows[0];
            if (subscription.status !== 'active' || subscription.current_period_end !== null || workspace?.status !== 'active') throw conflict('The Free workspace must be active before its upgrade payment can be approved.');
            // The business-owned worker activates Free upgrades and records its own permanent
            // business key. Approval only records the decision and queues that existing workflow.
            summary = {...summary,activation_pending:true,target_plan_code:price.code};
          } else {
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
            summary = { ...summary, current_period_end: updated.rows[0]?.current_period_end?.toISOString() ?? null };
          }
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
  };
}
