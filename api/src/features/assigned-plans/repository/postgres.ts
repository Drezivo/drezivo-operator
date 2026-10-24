import { entitlementDetailSchema, type BillingReadPort } from '../../subscriptions/contracts.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createAssignedPlansDbRepository(db: ConsoleDbContext): Pick<BillingReadPort, 'getEntitlements'> {
  return {
    async getEntitlements({ tenantId }) {
      const data = await db.projection('entitlements', { tenant_id: tenantId });
      return data === null ? null : entitlementDetailSchema.parse(data);
    },
  };
}
