import { businessDetailSchema, businessSummarySchema, type ReadPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createBusinessReadDbAdapter(db: ConsoleDbContext): Pick<ReadPort, 'listBusinesses' | 'getBusiness'> {
  return {
    async listBusinesses({ filters, limit, cursor }) {
      const page = await db.page('businesses', filters, limit, cursor?.createdAt, cursor?.tenantId, (value) => businessSummarySchema.parse(value));
      const last = page.items.at(-1);
      return { items: page.items, next_cursor: page.more && last ? { createdAt: last.created_at, tenantId: last.tenant_id } : null };
    },
    async getBusiness({ tenantId }) {
      const data = await db.projection('business', { tenant_id: tenantId });
      return data === null ? null : businessDetailSchema.parse(data);
    },
  };
}
