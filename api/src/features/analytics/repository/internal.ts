import { z } from 'zod';
import { AppError } from '../../../shared/http/errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../../infrastructure/http/internal-service-client.js';
import { createOperatorReadAssertion } from '../../../shared/auth/operator-read-assertion.js';
import {
  operatorAnalyticsResponse,
  type AnalyticsReadPort,
  type OperatorAnalyticsResponse,
} from '../index.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type AnalyticsReadAdapterOptions = {
  baseUrl: string;
  serviceAuth: (requestId: string) => string | Promise<string>;
  operatorAssertionSecret?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  allowInsecureTransport?: boolean;
};

const responseEnvelope = z.object({
  success: z.literal(true),
  data: z.unknown(),
  request_id: z.string().min(1).max(128),
}).strict();
const dependencyError = (code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string) => new AppError(503, code, message);

export function createAnalyticsReadAdapter(options: AnalyticsReadAdapterOptions): AnalyticsReadPort {
  const client: InternalServiceClient = createInternalServiceClient({
    ...options,
    fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined,
  });

  return {
    getAnalytics: async ({ principal, months, requestId }): Promise<OperatorAnalyticsResponse> => {
      const path = '/internal/operator/v1/analytics';
      // Only normalized contract values are serialized and bound into the signed assertion.
      const upstreamMonths = months === 6 ? 12 : months;
      const query = new URLSearchParams({ months: String(upstreamMonths) }).toString();
      const assertion = createOperatorReadAssertion({
        secret: options.operatorAssertionSecret,
        principal,
        requestId,
        permission: 'platform.analytics.read',
        path,
        query,
      });
      let response;
      try {
        response = await client.requestJsonResponse<unknown>(`${path}?${query}`, { requestId, operatorAssertion: assertion });
      } catch (cause) {
        if (cause instanceof AppError && cause.code === 'OPERATOR_AUTH_UNAVAILABLE') throw cause;
        if (cause instanceof AppError && cause.code === 'DEPENDENCY_INVALID_RESPONSE') {
          throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
        }
        throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.');
      }
      if (response.status !== 200 || response.data === null) {
        throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.');
      }
      const envelope = responseEnvelope.safeParse(response.data);
      if (!envelope.success || envelope.data.request_id !== requestId) {
        throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      }
      const data = operatorAnalyticsResponse.safeParse(envelope.data.data);
      if (!data.success || data.data.period.months !== upstreamMonths) {
        throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      }
      if (months !== 6) return data.data;
      const end = new Date(Date.parse(data.data.period.to) + 8 * 3600000);
      const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 6, 1) - 8 * 3600000).toISOString();
      const firstMonth = data.data.series.new_businesses.at(-6)?.month;
      if (!firstMonth) throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      const trim = (series: OperatorAnalyticsResponse['series']) => ({
        new_businesses: series.new_businesses.slice(-6), memberships: series.memberships.slice(-6),
        subscription_events: series.subscription_events.filter((point) => point.month >= firstMonth),
      });
      return operatorAnalyticsResponse.parse({ ...data.data, period: { ...data.data.period, from, months: 6 },
        series: trim(data.data.series), synthetic: { ...data.data.synthetic, series: trim(data.data.synthetic.series) } });
    },
  };
}
