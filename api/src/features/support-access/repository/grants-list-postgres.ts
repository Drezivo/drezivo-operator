import type { GrantListPort } from '../contracts.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createGrantListDbAdapter(db: ConsoleDbContext): GrantListPort {
  return {
    async list({ tenantId, limit, cursor }) {
      const page = await db.page('grants', tenantId ? { tenant_id: tenantId } : {}, limit, cursor?.at, cursor?.id, (value) => value);
      const last = page.items.at(-1) as { created_at: string; grant_id: string } | undefined;
      return { items: page.items, next_cursor: page.more && last ? { at: last.created_at, id: last.grant_id } : null };
    },
  };
}
