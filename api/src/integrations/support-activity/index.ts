import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { supportActivitySchema, type SupportActivityFilters, type SupportActivityPort } from '../../operator-support-activity/index.js';

export type SupportActivityAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown() }).strict();
const page = z.object({ items: z.array(supportActivitySchema), next_cursor: z.object({ occurredAt: z.string().datetime({ offset: true }), eventId: z.string().uuid() }).strict().nullable() }).strict();

export function createSupportActivityReadAdapter(options: SupportActivityAdapterOptions): SupportActivityPort {
  const client: InternalServiceClient = createInternalServiceClient(options);
  return {
    listSupportActivity: async ({ filters, limit, cursor, requestId }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      for (const [key, value] of Object.entries(filters) as Array<[keyof SupportActivityFilters, string | undefined]>) if (value !== undefined) params.set(key, value);
      if (cursor) { params.set('cursor_occurred_at', cursor.occurredAt); params.set('cursor_event_id', cursor.eventId); }
      try {
        const response = await client.requestJsonResponse<unknown>(`/internal/operator/v1/support-activity?${params.toString()}`, { requestId }, [200]);
        if (response.data === null) throw new Error('missing');
        const outer = envelope.safeParse(response.data);
        if (!outer.success) throw new Error('envelope');
        const parsed = page.safeParse(outer.data.data);
        if (!parsed.success) throw new Error('projection');
        return parsed.data;
      } catch (error) {
        if (error instanceof AppError && ['OPERATOR_AUTH_UNAVAILABLE', 'DEPENDENCY_INVALID_RESPONSE', 'DEPENDENCY_UNAVAILABLE'].includes(error.code)) throw error;
        throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The support activity read service is unavailable.');
      }
    },
  };
}
