import type pg from 'pg';
import type { TenantAdminPort } from '../administration/index.js';
import { notFound, type TenantAdminDbContext } from '../../../infrastructure/db/tenant-admin-context.js';

export function createTenantAdminCommandAdapter(context: TenantAdminDbContext): Pick<TenantAdminPort, 'updateProfile' | 'setTenantLocked' | 'setMemberSuspended' | 'addNote'> {
  const { command, tenantRow, subscriptionOf, liftLifecycleRestriction, conflict } = context;
  return {
    async updateProfile(tenantId, change, ctx) {
      return command(tenantId, 'tenant.profile.update', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        // Touch only the requested columns: business migration 0064 grants drezivo_app UPDATE on
        // tenant (name, status, updated_at), so writing timezone back unchanged was itself refused.
        const params: unknown[] = [tenantId];
        const sets: string[] = [];
        const differs: string[] = [];
        for (const column of ['name', 'timezone'] as const) {
          const value = change[column];
          if (value === undefined) continue;
          params.push(value);
          sets.push(`${column} = $${params.length}`);
          differs.push(`${column} IS DISTINCT FROM $${params.length}`);
        }
        let result: pg.QueryResult;
        try {
          result = await client.query(
            `UPDATE tenant SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND (${differs.join(' OR ')})`,
            params,
          );
        } catch (error) {
          if ((error as { code?: string }).code === '42501' && change.timezone !== undefined) {
            throw conflict('Changing the time zone is not available yet. Renaming the business still works.');
          }
          throw error;
        }
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

    async addNote(tenantId, body, authorLabel, ctx) {
      return command(tenantId, 'tenant.note.add', { kind: 'tenant', id: tenantId }, ctx, async (client) => {
        await client.query('INSERT INTO tenant_operator_note (tenant_id, body, author_label) VALUES ($1, $2, $3)', [tenantId, body, authorLabel]);
        // The note text stays out of the audit summary.
        return { changed: true, summary: { note_length: body.length } };
      });
    },
  };
}
