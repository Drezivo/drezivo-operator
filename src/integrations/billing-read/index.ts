import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { entitlementDetailSchema, subscriptionSummarySchema, type BillingReadPort, type EntitlementDetail } from '../../operator-billing/index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type BillingReadAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: FetchLike; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).optional() }).strict();
const uuid = z.string().uuid(); const iso = z.string().datetime({ offset: true });
const listResponse = z.object({ items: z.array(subscriptionSummarySchema), next_cursor: z.object({ currentPeriodEnd: iso, tenantId: uuid }).strict().nullable() }).strict();
const error = (code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string) => new AppError(503, code, message);

export function createBillingReadAdapter(options: BillingReadAdapterOptions): BillingReadPort {
  const client: InternalServiceClient = createInternalServiceClient({ ...options, fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined });
  const request = async <T>(path: string, schema: z.ZodType<T>, requestId: string, query?: URLSearchParams): Promise<T | null> => {
    let response;
    try { response = await client.requestJsonResponse<unknown>(query ? `${path}?${query.toString()}` : path, { requestId }); }
    catch (cause) { if (cause instanceof AppError && cause.code === 'OPERATOR_AUTH_UNAVAILABLE') throw cause; if (cause instanceof AppError && cause.code === 'DEPENDENCY_INVALID_RESPONSE') throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.'); throw error('DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); }
    if (response.data === null) return null;
    const parsedEnvelope = envelope.safeParse(response.data); if (!parsedEnvelope.success) throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.');
    const parsed = schema.safeParse(parsedEnvelope.data.data); if (!parsed.success) throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.'); return parsed.data;
  };
  return {
    listSubscriptions: async ({ filters, limit, cursor, requestId }) => {
      const params = new URLSearchParams({ limit: String(limit) }); if (filters.plan_code) params.set('plan_code', filters.plan_code); if (filters.status) params.set('status', filters.status); if (cursor) { params.set('cursor_current_period_end', cursor.currentPeriodEnd); params.set('cursor_tenant_id', cursor.tenantId); }
      const data = await request('/internal/operator/v1/subscriptions', listResponse, requestId, params); if (data === null) throw error('DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.');
      return data;
    },
    getEntitlements: async ({ tenantId, requestId }): Promise<EntitlementDetail | null> => request(`/internal/operator/v1/businesses/${encodeURIComponent(tenantId)}/entitlements`, entitlementDetailSchema, requestId),
  };
}
