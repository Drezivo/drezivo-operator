import { supportGrantProjectionSchema, type SupportGrantCommandPort } from '../index.js';
import type { ConsoleDbContext } from '../../../infrastructure/db/console-context.js';

export function createSupportGrantDbAdapter(db: ConsoleDbContext): SupportGrantCommandPort {
  return {
    async createSupportGrant({ operatorSubject, idempotencyKey, requestId, ...body }) {
      return supportGrantProjectionSchema.parse(await db.command('grant.create', operatorSubject, idempotencyKey, requestId, body));
    },
    async revokeSupportGrant({ operatorSubject, idempotencyKey, requestId, grantId }) {
      return supportGrantProjectionSchema.parse(await db.command('grant.revoke', operatorSubject, idempotencyKey, requestId, { grant_id: grantId }));
    },
  };
}
