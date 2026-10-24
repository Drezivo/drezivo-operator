import { jobSchema, notificationSchema, type OperationsPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createOperationsDbAdapter(db: ConsoleDbContext): OperationsPort {
  return {
    async listJobs({ filters, limit, cursor }) {
      const page = await db.page('jobs', filters, limit, cursor?.availableAt, cursor?.id, (value) => jobSchema.parse(value));
      const last = page.items.at(-1);
      return { items: page.items, next_cursor: page.more && last ? { availableAt: last.available_at, id: last.job_id } : null };
    },
    async listNotifications({ filters, limit, cursor }) {
      const page = await db.page('notifications', filters, limit, cursor?.acceptedAt, cursor?.deliveryId, (value) => notificationSchema.parse(value));
      const last = page.items.at(-1);
      return { items: page.items, next_cursor: page.more && last ? { acceptedAt: last.accepted_at, deliveryId: last.delivery_id } : null };
    },
  };
}
