import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { auditEventSchema, type AuditEvent, type AuditFilters, type AuditPort } from '../../operator-audit/index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type AuditReadAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: FetchLike; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).optional() }).strict();
const uuid = z.string().uuid(); const iso = z.string().datetime({ offset: true });
const page = z.object({ items: z.array(auditEventSchema), next_cursor: z.object({ occurredAt: iso, eventId: uuid }).strict().nullable() }).strict();
const failure = (code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string) => new AppError(503, code, message);

export function createAuditReadAdapter(options: AuditReadAdapterOptions): AuditPort {
  const client: InternalServiceClient = createInternalServiceClient({ ...options, fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined });
  return {
    listAuditEvents: async ({ filters, limit, cursor, requestId }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, value);
      if (cursor) { params.set('cursor_occurred_at', cursor.occurredAt); params.set('cursor_event_id', cursor.eventId); }
      let response;
      try { response = await client.requestJsonResponse<unknown>(`/internal/operator/v1/audit-events?${params.toString()}`, { requestId }, [200]); }
      catch (cause) { if (cause instanceof AppError && cause.code === 'OPERATOR_AUTH_UNAVAILABLE') throw cause; if (cause instanceof AppError && cause.code === 'DEPENDENCY_INVALID_RESPONSE') throw failure('DEPENDENCY_INVALID_RESPONSE', 'The audit read service returned an invalid response.'); throw failure('DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.'); }
      if (response.data === null) throw failure('DEPENDENCY_UNAVAILABLE', 'The audit read service is unavailable.');
      const outer = envelope.safeParse(response.data); if (!outer.success) throw failure('DEPENDENCY_INVALID_RESPONSE', 'The audit read service returned an invalid response.');
      const parsed = page.safeParse(outer.data.data); if (!parsed.success) throw failure('DEPENDENCY_INVALID_RESPONSE', 'The audit read service returned an invalid response.');
      return parsed.data;
    },
  };
}
