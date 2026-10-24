import type { AnalyticsReadPort } from '../../features/analytics/index.js';
import type { AuditPort } from '../../features/audit-logs/index.js';
import type { BillingReadPort } from '../../features/subscriptions/index.js';
import type { SessionAuditPort, GrantListPort } from '../../features/sessions/index.js';
import type { OperatorDirectoryPort } from '../../features/operators/index.js';
import type { OperationsPort } from '../../features/operations/index.js';
import type { OperationsRetryCommandPort } from '../../features/operations/retry/index.js';
import type { ReadPort } from '../../features/clients/index.js';
import type { SupportGrantCommandPort } from '../../features/support-access/index.js';
import type { WorkspacePort } from '../../features/support-access/workspace/index.js';
import type { TenantAdminDbOptions } from '../../features/clients/repository/admin.js';
import { createAnalyticsDbAdapter } from '../../features/analytics/repository/console-read.js';
import { createAuditDbAdapter } from '../../features/audit-logs/repository/postgres.js';
import { createBillingDbAdapter } from '../../features/subscriptions/repository/postgres.js';
import { createAssignedPlansDbRepository } from '../../features/assigned-plans/repository/postgres.js';
import { createConsoleDbContext } from './console-context.js';
import { createBusinessReadDbAdapter } from '../../features/clients/repository/postgres.js';
import { createOverviewDbRepository } from '../../features/overview/repository/postgres.js';
import { createOperationsDbAdapter } from '../../features/operations/repository/postgres.js';
import { createRetryDbAdapter } from '../../features/operations/repository/retry-postgres.js';
import { createSessionAuditDbAdapter } from '../../features/sessions/repository/postgres.js';
import { createGrantListDbAdapter } from '../../features/support-access/repository/grants-list-postgres.js';
import { createSupportGrantDbAdapter } from '../../features/support-access/repository/grants-postgres.js';
import { createWorkspaceDbAdapter } from '../../features/support-access/repository/workspace-postgres.js';

export type ConsolePorts = {
  workspace: WorkspacePort;
  directory?: OperatorDirectoryPort;
  audit: AuditPort;
  billing: BillingReadPort;
  read: ReadPort;
  operations: OperationsPort;
  grants: SupportGrantCommandPort;
  retry: OperationsRetryCommandPort;
  session: SessionAuditPort;
  grantList: GrantListPort;
  analytics: AnalyticsReadPort;
};

/** Composes feature-specific adapters over one least-privilege PostgreSQL context. */
export function createConsoleDbAdapter(options: TenantAdminDbOptions & { synthetic?: boolean }): ConsolePorts & { close(): Promise<void> } {
  const db = createConsoleDbContext(options);
  return {
    workspace: createWorkspaceDbAdapter(db),
    audit: createAuditDbAdapter(db),
    billing: { ...createBillingDbAdapter(db), ...createAssignedPlansDbRepository(db) },
    read: { ...createOverviewDbRepository(db), ...createBusinessReadDbAdapter(db) },
    operations: createOperationsDbAdapter(db),
    grants: createSupportGrantDbAdapter(db),
    retry: createRetryDbAdapter(db),
    session: createSessionAuditDbAdapter(db),
    grantList: createGrantListDbAdapter(db),
    analytics: createAnalyticsDbAdapter(db, options.synthetic),
    close: db.close,
  };
}
