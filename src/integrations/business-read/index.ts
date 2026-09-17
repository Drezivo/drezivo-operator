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
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type BusinessReadAdapterOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  serviceAuth: (requestId: string) => string | Promise<string>;
  timeoutMs?: number;
  allowInsecureTransport?: boolean;
};

const envelopeSchema = z.object({ success: z.literal(true), data: z.unknown(), request_id: z.string().min(1).optional() }).strict();
const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const listSchema = z.object({
  items: z.array(businessSummarySchema),
  next_cursor: z.object({ createdAt: isoDate, tenantId: uuid }).strict().nullable(),
}).strict();

function dependencyError(code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string): AppError {
  return new AppError(503, code, message);
}

export function createBusinessReadAdapter(options: BusinessReadAdapterOptions): ReadPort {
  const client: InternalServiceClient = createInternalServiceClient({ ...options, fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined });
  const request = async <T>(path: string, schema: z.ZodType<T>, requestId: string, query?: URLSearchParams): Promise<T | null> => {
    const fullPath = query ? `${path}?${query.toString()}` : path;
    let response;
    try { response = await client.requestJsonResponse<unknown>(fullPath, { requestId }); }
    catch (error) {
      if (error instanceof AppError && error.code === 'DEPENDENCY_INVALID_RESPONSE') throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
    }
    if (response.data === null) return null;
    const envelope = envelopeSchema.safeParse(response.data);
    if (!envelope.success) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
    return parsed.data;
  };
  return {
    overview: async ({ asOf, requestId }): Promise<OperatorOverview> => {
      const data = await request('/internal/operator/v1/overview', operatorOverviewSchema, requestId, asOf ? new URLSearchParams({ as_of: asOf }) : undefined);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return data;
    },
    listBusinesses: async ({ filters, limit, cursor, requestId }): Promise<BusinessListResult> => {
      const params = new URLSearchParams({ sort: filters.sort, limit: String(limit) });
      if (filters.q) params.set('q', filters.q);
      if (filters.plan_code) params.set('plan_code', filters.plan_code);
      for (const status of filters.status) params.append('status', status);
      if (cursor) { params.set('cursor_created_at', cursor.createdAt); params.set('cursor_tenant_id', cursor.tenantId); }
      const data = await request('/internal/operator/v1/businesses', listSchema, requestId, params);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return data;
    },
    getBusiness: async ({ tenantId, requestId }): Promise<BusinessDetail | null> => request(`/internal/operator/v1/businesses/${encodeURIComponent(tenantId)}`, businessDetailSchema, requestId),
  };
}

export type { BusinessDetail, BusinessListFilters, BusinessSummary };
