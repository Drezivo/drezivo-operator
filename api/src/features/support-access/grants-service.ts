import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/http/errors.js';
import { supportGrantProjectionSchema, type GrantListPort } from './contracts.js';

const grant = supportGrantProjectionSchema.safeExtend({ business_name: z.string().min(1), granted_by: z.string().min(1), status: z.enum(['active', 'scheduled', 'expired', 'revoked']) });
const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid(), scope: z.string() }).strict();

export function createGrantListService(repository: GrantListPort | undefined) {
  return async (query: { tenant_id?: string; limit: number; cursor?: string }) => {
    const scope = createHash('sha256').update(query.tenant_id ?? 'all').digest('hex');
    let after: { at: string; id: string } | null = null;
    if (query.cursor) {
      try {
        const decoded = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
        if (decoded.scope !== scope) throw new Error();
        after = { at: decoded.at, id: decoded.id };
      } catch {
        throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.');
      }
    }
    if (!repository) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Support grants are unavailable.');
    const data = await repository.list({ tenantId: query.tenant_id, limit: query.limit, cursor: after });
    return {
      items: data.items.map((item) => grant.parse(item)),
      next_cursor: data.next_cursor ? Buffer.from(JSON.stringify({ ...data.next_cursor, scope })).toString('base64url') : null,
    };
  };
}
