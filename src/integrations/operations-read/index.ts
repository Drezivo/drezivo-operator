import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { jobSchema, notificationSchema, type OperationsPort } from '../../operator-operations/index.js';

export type OperationsReadAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).optional() }).strict();
const jobs = z.object({ items: z.array(jobSchema), next_cursor: z.object({ availableAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict().nullable() }).strict();
const notifications = z.object({ items: z.array(notificationSchema), next_cursor: z.object({ acceptedAt: z.string().datetime({ offset: true }).nullable(), deliveryId: z.string().uuid() }).strict().nullable() }).strict();
const invalid = () => new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The operations service returned an invalid response.');
const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations service is unavailable.');
export function createOperationsReadAdapter(options: OperationsReadAdapterOptions): OperationsPort {
  if (!options.serviceAuth) throw unavailable();
  let client: InternalServiceClient;
  try { client = createInternalServiceClient(options); } catch { throw unavailable(); }
  async function get<T>(path: string, schema: z.ZodType<T>, requestId: string, params: URLSearchParams): Promise<T> {
    try { const response = await client.requestJsonResponse<unknown>(`${path}?${params.toString()}`, { requestId }, [200]); if (response.data === null) throw unavailable(); const outer = envelope.safeParse(response.data); if (!outer.success) throw invalid(); const parsed = schema.safeParse(outer.data.data); if (!parsed.success) throw invalid(); return parsed.data; } catch (e) { if (e instanceof AppError && (e.code === 'DEPENDENCY_INVALID_RESPONSE' || e.code === 'DEPENDENCY_UNAVAILABLE' || e.code === 'OPERATOR_AUTH_UNAVAILABLE')) throw e; throw unavailable(); }
  }
  return {
    listJobs: ({ filters, limit, cursor, requestId }) => { const p = new URLSearchParams({ limit: String(limit) }); for (const [k, v] of Object.entries(filters)) if (v !== undefined) p.set(k, v); if (cursor) { p.set('cursor_available_at', cursor.availableAt); p.set('cursor_id', cursor.id); } return get('/internal/operator/v1/jobs', jobs, requestId, p); },
    listNotifications: ({ filters, limit, cursor, requestId }) => { const p = new URLSearchParams({ limit: String(limit) }); for (const [k, v] of Object.entries(filters)) if (v !== undefined) p.set(k, v); if (cursor) { if (cursor.acceptedAt !== null) p.set('cursor_accepted_at', cursor.acceptedAt); p.set('cursor_delivery_id', cursor.deliveryId); } return get('/internal/operator/v1/notifications', notifications, requestId, p); },
  };
}
