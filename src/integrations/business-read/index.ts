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

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RequestAuth = string | (() => string | undefined);

export type BusinessReadAdapterOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  requestAuth?: RequestAuth;
  timeoutMs?: number;
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

function authValue(auth: RequestAuth | undefined): string | undefined {
  return typeof auth === 'function' ? auth() : auth;
}

export function createBusinessReadAdapter(options: BusinessReadAdapterOptions): ReadPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('timeoutMs must be an integer between 1 and 30000');
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('unsupported protocol');
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    if (base.protocol === 'http:' && !localHosts.has(base.hostname)) throw new Error('insecure remote protocol');
  } catch {
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
  }
  const request = async <T>(path: string, schema: z.ZodType<T>, query?: URLSearchParams): Promise<T | null> => {
    const url = new URL(path, base);
    if (query) url.search = query.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        const token = authValue(options.requestAuth);
        response = await fetchImpl(url, {
          method: 'GET', signal: controller.signal,
          headers: token ? { authorization: token, accept: 'application/json' } : { accept: 'application/json' },
        });
      } catch {
        throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      }
      if (response.status === 404) return null;
      if (!response.ok) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.'); }
      const envelope = envelopeSchema.safeParse(body);
      if (!envelope.success) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      const parsed = schema.safeParse(envelope.data.data);
      if (!parsed.success) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The business read service returned an invalid response.');
      return parsed.data;
    } finally { clearTimeout(timer); }
  };
  return {
    overview: async ({ asOf }): Promise<OperatorOverview> => {
      const data = await request('/internal/operator/v1/overview', operatorOverviewSchema, asOf ? new URLSearchParams({ as_of: asOf }) : undefined);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return data;
    },
    listBusinesses: async ({ filters, limit, cursor }): Promise<BusinessListResult> => {
      const params = new URLSearchParams({ sort: filters.sort, limit: String(limit) });
      if (filters.q) params.set('q', filters.q);
      if (filters.plan_code) params.set('plan_code', filters.plan_code);
      for (const status of filters.status) params.append('status', status);
      if (cursor) { params.set('cursor_created_at', cursor.createdAt); params.set('cursor_tenant_id', cursor.tenantId); }
      const data = await request('/internal/operator/v1/businesses', listSchema, params);
      if (data === null) throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The business read service is unavailable.');
      return data;
    },
    getBusiness: async ({ tenantId }): Promise<BusinessDetail | null> => request(`/internal/operator/v1/businesses/${encodeURIComponent(tenantId)}`, businessDetailSchema),
  };
}

export type { BusinessDetail, BusinessListFilters, BusinessSummary };
