import { subscriptionSummarySchema, type BillingReadPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createBillingDbAdapter(db: ConsoleDbContext): Pick<BillingReadPort, 'listSubscriptions'> {
  return {
    async listSubscriptions({ filters, limit, cursor }) {
      const page = await db.page('subscriptions', filters, limit, cursor?.currentPeriodEnd, cursor?.tenantId, (value) => subscriptionSummarySchema.parse(value));
      const last = page.items.at(-1);
      return { items: page.items, next_cursor: page.more && last ? { currentPeriodEnd: last.current_period_end, tenantId: last.tenant_id } : null };
    },
  };
}
