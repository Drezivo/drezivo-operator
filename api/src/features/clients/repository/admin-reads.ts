import type { PersonRow, TenantAdminPort, TenantSummary } from '../administration/index.js';
import { iso, notFound, type TenantAdminDbContext } from '../../../infrastructure/db/tenant-admin-context.js';

export function createTenantAdminReadAdapter(context: TenantAdminDbContext): Pick<TenantAdminPort, 'listPeople' | 'listTenants' | 'getTenant'> {
  const { operatorRead, transaction, tenantRow, detailOf, TENANT_LIST_LIMIT, PEOPLE_LIST_LIMIT } = context;
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
        subscription: row.subscription_status && row.plan_code ? {
          status: row.subscription_status,
          plan_code: row.plan_code,
          trial_ends_at: iso(row.trial_ends_at),
          grace_ends_at: iso(row.grace_ends_at),
          current_period_end: iso(row.current_period_end),
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
  };
}
