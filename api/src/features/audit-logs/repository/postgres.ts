import { auditEventSchema, type AuditPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createAuditDbAdapter(db: ConsoleDbContext): AuditPort {
  return {
    async listAuditEvents({ filters, limit, cursor }) {
      const page = await db.page('audit', filters, limit, cursor?.occurredAt, cursor?.eventId, (value) => auditEventSchema.parse(value));
      const last = page.items.at(-1);
      return { items: page.items, next_cursor: page.more && last ? { occurredAt: last.occurred_at, eventId: last.event_id } : null };
    },
  };
}
