import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { jobSchema, notificationSchema, type OperationsPort } from '../../operator-operations/index.js';
import { createOperatorReadAssertion } from '../../operator-read-assertion.js';
import type { SafeOperatorPrincipal } from '../../operator-auth.js';

export type OperationsReadAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; operatorAssertionSecret?: string; fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).max(128) }).strict();
const upstreamJob = z.object({ job_id: z.string().uuid(), tenant_id: z.string().uuid(), event_type: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), status: z.enum(['pending', 'leased', 'succeeded', 'dead']), attempts: z.number().int().nonnegative().safe(), max_attempts: z.number().int().positive().safe(), available_at: z.string().datetime({ offset: true }), lease_until: z.string().datetime({ offset: true }).nullable(), completed_at: z.string().datetime({ offset: true }).nullable(), safe_last_error: z.null(), created_at: z.string().datetime({ offset: true }) }).strict();
const upstreamNotification = z.object({ delivery_id: z.string().uuid(), tenant_id: z.string().uuid(), outbox_id: z.string().uuid(), channel: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), template_version: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), status: z.enum(['queued', 'provider_accepted', 'delivered', 'bounced', 'failed']), provider_message_id: z.null(), accepted_at: z.string().datetime({ offset: true }).nullable(), delivered_at: z.string().datetime({ offset: true }).nullable() }).strict();
const jobs = z.object({ items: z.array(upstreamJob), next_cursor: z.object({ availableAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict().nullable() }).strict();
const notifications = z.object({ items: z.array(upstreamNotification), next_cursor: z.object({ acceptedAt: z.string().datetime({ offset: true }).nullable(), deliveryId: z.string().uuid() }).strict().nullable() }).strict();
const invalid = () => new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The operations service returned an invalid response.');
const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The operations service is unavailable.');
export function createOperationsReadAdapter(options: OperationsReadAdapterOptions): OperationsPort {
  if (!options.serviceAuth) throw unavailable();
  let client: InternalServiceClient;
  try { client = createInternalServiceClient(options); } catch { throw unavailable(); }
  async function get<T>(path: string, schema: z.ZodType<T>, requestId: string, params: URLSearchParams, principal: SafeOperatorPrincipal, permission: 'job.read' | 'notification.read'): Promise<T> {
    const query = params.toString();
    const assertion = createOperatorReadAssertion({ secret: options.operatorAssertionSecret, principal, requestId, permission, path, query });
    try { const response = await client.requestJsonResponse<unknown>(`${path}?${query}`, { requestId, operatorAssertion: assertion }, [200]); if (response.data === null) throw unavailable(); const outer = envelope.safeParse(response.data); if (!outer.success || outer.data.request_id !== requestId) throw invalid(); const parsed = schema.safeParse(outer.data.data); if (!parsed.success) throw invalid(); return parsed.data; } catch (e) { if (e instanceof AppError && (e.code === 'DEPENDENCY_INVALID_RESPONSE' || e.code === 'DEPENDENCY_UNAVAILABLE' || e.code === 'OPERATOR_AUTH_UNAVAILABLE')) throw e; throw unavailable(); }
  }
  return {
    listJobs: async ({ principal, filters, limit, cursor, requestId }) => { const p = new URLSearchParams({ limit: String(limit) }); for (const [k, v] of Object.entries(filters)) if (v !== undefined) p.set(k, v); if (cursor) { p.set('cursor_available_at', cursor.availableAt); p.set('cursor_id', cursor.id); } const result = await get('/internal/operator/v1/jobs', jobs, requestId, p, principal, 'job.read'); return { ...result, items: result.items.map((item) => jobSchema.parse(item)) }; },
    listNotifications: async ({ principal, filters, limit, cursor, requestId }) => { const p = new URLSearchParams({ limit: String(limit) }); for (const [k, v] of Object.entries(filters)) if (v !== undefined) p.set(k, v); if (cursor) { if (cursor.acceptedAt !== null) p.set('cursor_accepted_at', cursor.acceptedAt); p.set('cursor_delivery_id', cursor.deliveryId); } const result = await get('/internal/operator/v1/notifications', notifications, requestId, p, principal, 'notification.read'); return { ...result, items: result.items.map((item) => notificationSchema.parse(item)) }; },
  };
}
