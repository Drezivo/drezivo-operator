import { retryResultSchema, type OperationsRetryCommandPort } from '../retry/index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createRetryDbAdapter(db: ConsoleDbContext): OperationsRetryCommandPort {
  return {
    async retryJob({ operatorSubject, idempotencyKey, requestId, jobId, ...body }) {
      return retryResultSchema.parse(await db.command('job.retry', operatorSubject, idempotencyKey, requestId, { ...body, resource_id: jobId }));
    },
    async retryNotification({ operatorSubject, idempotencyKey, requestId, deliveryId, ...body }) {
      return retryResultSchema.parse(await db.command('notification.retry', operatorSubject, idempotencyKey, requestId, { ...body, resource_id: deliveryId }));
    },
  };
}
