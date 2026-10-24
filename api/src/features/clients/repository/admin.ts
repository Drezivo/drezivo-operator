import type { TenantAdminPort } from '../administration/index.js';
import { createTenantAdminCommandAdapter } from './admin-commands.js';
import { createSubscriptionAdminCommandAdapter } from '../../subscriptions/repository/admin-commands.js';
import { createTenantAdminDbContext, type TenantAdminDbOptions } from '../../../infrastructure/db/tenant-admin-context.js';
import { createTenantPaymentAdapter } from '../../payments/repository/admin-payments.js';
import { createTenantAdminReadAdapter } from './admin-reads.js';

export type { TenantAdminDbOptions } from '../../../infrastructure/db/tenant-admin-context.js';

export function createTenantAdminDbAdapter(options: TenantAdminDbOptions): TenantAdminPort & { close(): Promise<void> } {
  const context = createTenantAdminDbContext(options);
  return {
    ...createTenantAdminReadAdapter(context),
    ...createTenantAdminCommandAdapter(context),
    ...createSubscriptionAdminCommandAdapter(context),
    ...createTenantPaymentAdapter(context),
    close: context.close,
  };
}
