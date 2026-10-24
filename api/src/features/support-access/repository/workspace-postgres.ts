import type { WorkspacePort } from '../workspace/index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createWorkspaceDbAdapter(db: ConsoleDbContext): WorkspacePort {
  return {
    async execute({ operation, subject, tenantId, grantId, idempotencyKey, requestId, input }) {
      return db.transaction(subject, true, async (client) => (
        await client.query<{ data: unknown }>(
          'SELECT operator_workspace($1,$2,$3::uuid,$4::uuid,$5,$6,$7::jsonb) AS data',
          [operation, subject, tenantId, grantId ?? null, idempotencyKey ?? null, requestId, JSON.stringify(input)],
        )
      ).rows[0]?.data);
    },
  };
}
