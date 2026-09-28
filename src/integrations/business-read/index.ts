import { AppError } from '../../errors.js';
import {
  businessDetailSchema,
  businessSummarySchema,
  operatorOverviewSchema,
  type BusinessDetail,
  type BusinessListFilters,
  type BusinessSummary,
  type BusinessListResult,
  type OperatorOverview,
  type ReadPort,
} from '../../operator-read/index.js';
import { z } from 'zod';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { createOperatorOverviewAssertion } from '../../operator-assertion.js';
import { createOperatorReadAssertion } from '../../operator-read-assertion.js';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type BusinessReadAdapterOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  serviceAuth: (requestId: string) => string | Promise<string>;
  operatorAssertionSecret?: string;
  timeoutMs?: number;
  allowInsecureTransport?: boolean;
};

const envelopeSchema = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).max(128) }).strict();
const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const upstreamBusinessListItem = z.object({
  id: uuid, name: z.string().min(1), slug: z.string().min(1), status: z.enum(['active', 'restricted', 'cancelled']),
  currency: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1), created_at: isoDate, updated_at: isoDate,
  plan_code: z.enum(['starter', 'professional', 'business']).nullable(),
  subscription_status: z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']).nullable(),
  current_period_end: isoDate.nullable(), cancel_at_period_end: z.boolean().nullable(),
  branch_count: z.number().int().nonnegative().safe(), active_membership_count: z.number().int().nonnegative().safe(),
}).strict().superRefine((item, ctx) => {
  const subFields = [item.plan_code, item.subscription_status, item.current_period_end, item.cancel_at_period_end];
  if (subFields.some((field) => field === null) && subFields.some((field) => field !== null)) ctx.addIssue({ code: 'custom', message: 'Incomplete subscription projection.' });
});
const upstreamBusinessListSchema = z.object({
  items: z.array(upstreamBusinessListItem), next_cursor: z.string().min(1).max(512).nullable(),
}).strict();
const upstreamBusinessDetailSchema = z.object({
  business: z.object({ id: uuid, name: z.string().min(1), slug: z.string().min(1), status: z.enum(['active', 'restricted', 'cancelled']), currency: z.string().regex(/^[A-Z]{3}$/), timezone: z.string().min(1), created_at: isoDate, updated_at: isoDate }).strict(),
  branches: z.array(z.object({ id: uuid, name: z.string().min(1), code: z.string().min(1), is_default: z.boolean(), timezone: z.string().min(1), status: z.enum(['active', 'restricted', 'cancelled']), created_at: isoDate }).strict()),
  membership_counts: z.object({ active: z.number().int().nonnegative().safe(), suspended: z.number().int().nonnegative().safe(), removed: z.number().int().nonnegative().safe(), invited: z.number().int().nonnegative().safe() }).strict(),
  subscription: z.object({ plan_code: z.enum(['starter', 'professional', 'business']), status: z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']), current_period_start: isoDate, current_period_end: isoDate, trial_ends_at: isoDate.nullable(), grace_ends_at: isoDate.nullable(), cancel_at_period_end: z.boolean() }).strict().nullable(),
  entitlements: z.object({ enabled_capability_count: z.number().int().nonnegative().safe(), disabled_capability_count: z.number().int().nonnegative().safe(), overridden_capability_count: z.literal(0) }).strict(),
}).strict();

function decodeUpstreamCursor(value: string): { createdAt: string; tenantId: string } {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const cursor = z.object({ createdAt: isoDate, id: uuid }).strict().parse(JSON.parse(bytes.toString('utf8')));
    return { createdAt: cursor.createdAt, tenantId: cursor.id };
  } catch { throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.'); }
}

function dependencyError(code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string): AppError {
  return new AppError(503, code, message);
}

export function createBusinessReadAdapter(options: BusinessReadAdapterOptions): ReadPort {
  const client: InternalServiceClient = createInternalServiceClient({ ...options, fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined });
  const request = async <T>(path: string, schema: z.ZodType<T>, requestId: string, query?: URLSearchParams, operatorAssertion?: string): Promise<T | null> => {
    const fullPath = query ? `${path}?${query.toString()}` : path;
    let response;
    try { response = await client.requestJsonResponse<unknown>(fullPath, { requestId, operatorAssertion }); }
    catch (error) {
      if (error instanceof AppError && error.code === 'OPERATOR_AUTH_UNAVAILABLE') throw error;
      if (error instanceof AppError && error.code === 'DEPENDENCY_INVALID_RESPONSE') throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
    }
    if (response.data === null) return null;
    const envelope = envelopeSchema.safeParse(response.data);
    if (!envelope.success || envelope.data.request_id !== requestId) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
    return parsed.data;
  };
  return {
    overview: async ({ principal, requestId }): Promise<OperatorOverview> => {
      const assertion = createOperatorOverviewAssertion({ secret: options.operatorAssertionSecret, principal, requestId });
      const data = await request('/internal/operator/v1/overview', operatorOverviewSchema, requestId, undefined, assertion);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return data;
    },
    listBusinesses: async ({ principal, filters, limit, cursor, requestId }): Promise<BusinessListResult> => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (filters.q) params.set('q', filters.q);
      if (filters.plan_code) params.set('plan_code', filters.plan_code);
      if (filters.status.length === 1) params.set('status', filters.status[0]!);
      else if (filters.status.length > 1) for (const status of filters.status) params.append('status', status);
      if (cursor) params.set('cursor', Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.tenantId }), 'utf8').toString('base64url'));
      const assertion = createOperatorReadAssertion({ secret: options.operatorAssertionSecret, principal, requestId, permission: 'operator.business.list.read', path: '/internal/operator/v1/businesses' });
      const data = await request('/internal/operator/v1/businesses', upstreamBusinessListSchema, requestId, params, assertion);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return {
        items: data.items.map((item) => ({
          tenant_id: item.id, business_name: item.name, slug: item.slug, status: item.status, currency: item.currency,
          timezone: item.timezone, created_at: item.created_at, updated_at: item.updated_at, branch_count: item.branch_count,
          active_member_count: item.active_membership_count,
          subscription: item.plan_code === null ? null : { plan_code: item.plan_code, status: item.subscription_status!, current_period_end: item.current_period_end!, cancel_at_period_end: item.cancel_at_period_end! },
        })),
        next_cursor: data.next_cursor === null ? null : decodeUpstreamCursor(data.next_cursor),
      };
    },
    getBusiness: async ({ tenantId, requestId, principal }): Promise<BusinessDetail | null> => {
      const path = `/internal/operator/v1/businesses/${encodeURIComponent(tenantId)}`;
      const assertion = createOperatorReadAssertion({ secret: options.operatorAssertionSecret, principal, requestId, permission: 'operator.business.detail.read', path, tenantId });
      const data = await request(path, upstreamBusinessDetailSchema, requestId, undefined, assertion);
      if (data === null) return null;
      if (data.business.id !== tenantId) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      return businessDetailSchema.parse({
        tenant_id: data.business.id, business_name: data.business.name, slug: data.business.slug, status: data.business.status,
        currency: data.business.currency, timezone: data.business.timezone, created_at: data.business.created_at, updated_at: data.business.updated_at,
        branches: data.branches.map((branch) => ({ branch_id: branch.id, name: branch.name, code: branch.code, status: branch.status, timezone: branch.timezone })),
        membership_summary: { active_count: data.membership_counts.active, invited_count: data.membership_counts.invited, suspended_count: data.membership_counts.suspended },
        subscription: data.subscription,
        entitlement_summary: { capability_count: data.entitlements.enabled_capability_count + data.entitlements.disabled_capability_count, overridden_capability_count: data.entitlements.overridden_capability_count },
      });
    },
  };
}

export type { BusinessDetail, BusinessListFilters, BusinessSummary };
