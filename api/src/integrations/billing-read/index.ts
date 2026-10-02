import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { entitlementDetailSchema, type BillingReadPort, type EntitlementDetail } from '../../operator-billing/index.js';
import { createOperatorReadAssertion } from '../../operator-read-assertion.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type BillingReadAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; operatorAssertionSecret?: string; fetchImpl?: FetchLike; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).max(128) }).strict();
const uuid = z.string().uuid(); const iso = z.string().datetime({ offset: true });
const upstreamSubscription = z.object({ id: uuid, name: z.string().min(1), plan_code: z.enum(['starter', 'professional', 'business']), status: z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']), currency: z.string().regex(/^[A-Z]{3}$/), current_period_start: iso, current_period_end: iso, cancel_at_period_end: z.boolean() }).strict();
const listResponse = z.object({ items: z.array(upstreamSubscription), next_cursor: z.object({ currentPeriodEnd: iso, tenantId: uuid }).strict().nullable() }).strict();
const upstreamEntitlements = z.object({ tenant_id: uuid, plan_code: z.enum(['starter', 'professional', 'business']), plan_version: z.literal(1), source: z.literal('plan_definition'), capability_count: z.literal(2), capabilities: z.array(z.object({ capability: z.enum(['physical_assets.max', 'frontdesk_seats.max']), enabled: z.boolean(), limit_value: z.number().int().nonnegative().safe().nullable() }).strict()).length(2) }).strict();
const error = (code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string) => new AppError(503, code, message);

export function createBillingReadAdapter(options: BillingReadAdapterOptions): BillingReadPort {
  const client: InternalServiceClient = createInternalServiceClient({ ...options, fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined });
  const request = async <T>(path: string, schema: z.ZodType<T>, requestId: string, query?: URLSearchParams, operatorAssertion?: string): Promise<T | null> => {
    let response;
    try { response = await client.requestJsonResponse<unknown>(query ? `${path}?${query.toString()}` : path, { requestId, operatorAssertion }); }
    catch (cause) { if (cause instanceof AppError && cause.code === 'OPERATOR_AUTH_UNAVAILABLE') throw cause; if (cause instanceof AppError && cause.code === 'DEPENDENCY_INVALID_RESPONSE') throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.'); throw error('DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.'); }
    if (response.data === null) return null;
    const parsedEnvelope = envelope.safeParse(response.data); if (!parsedEnvelope.success || parsedEnvelope.data.request_id !== requestId) throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.');
    const parsed = schema.safeParse(parsedEnvelope.data.data); if (!parsed.success) throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.'); return parsed.data;
  };
  return {
    listSubscriptions: async ({ principal, filters, limit, cursor, requestId }) => {
      const params = new URLSearchParams({ limit: String(limit) }); if (filters.plan_code) params.set('plan_code', filters.plan_code); if (filters.status) params.set('status', filters.status); if (cursor) { params.set('cursor_current_period_end', cursor.currentPeriodEnd); params.set('cursor_tenant_id', cursor.tenantId); }
      const path = '/internal/operator/v1/subscriptions';
      const assertion = createOperatorReadAssertion({ secret: options.operatorAssertionSecret, principal, requestId, permission: 'operator.subscription.list.read', path });
      const data = await request(path, listResponse, requestId, params, assertion); if (data === null) throw error('DEPENDENCY_UNAVAILABLE', 'The billing read service is unavailable.');
      return { items: data.items.map((item) => ({ tenant_id: item.id, business_name: item.name, plan_code: item.plan_code, status: item.status, currency: item.currency, current_period_start: item.current_period_start, current_period_end: item.current_period_end, cancel_at_period_end: item.cancel_at_period_end })), next_cursor: data.next_cursor };
    },
    getEntitlements: async ({ principal, tenantId, requestId }): Promise<EntitlementDetail | null> => {
      const path = `/internal/operator/v1/businesses/${encodeURIComponent(tenantId)}/entitlements`;
      const assertion = createOperatorReadAssertion({ secret: options.operatorAssertionSecret, principal, requestId, permission: 'operator.entitlements.read', path, tenantId });
      const data = await request(path, upstreamEntitlements, requestId, undefined, assertion);
      if (data === null) return null;
      if (data.tenant_id !== tenantId) throw error('DEPENDENCY_INVALID_RESPONSE', 'The billing read service returned an invalid response.');
      return entitlementDetailSchema.parse({ tenant_id: data.tenant_id, plan_code: data.plan_code, capability_count: data.capability_count, overridden_capability_count: 0, capabilities: data.capabilities });
    },
  };
}
