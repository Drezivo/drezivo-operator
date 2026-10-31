import { z } from 'zod';
import { AppError, remapDependencyError } from '../../../shared/http/errors.js';
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
const dependencyError = (code: 'DEPENDENCY_UNAVAILABLE' | 'DEPENDENCY_INVALID_RESPONSE', message: string, cause?: unknown) => {
  const diagnostics = { dependency: 'internal_service' as const, reason: code === 'DEPENDENCY_INVALID_RESPONSE' ? 'invalid_response' as const : 'dependency_unavailable' as const };
  return cause === undefined ? new AppError(503, code, message, { diagnostics }) : remapDependencyError(cause, { code, message, diagnostics });
};

export function createAnalyticsReadAdapter(options: AnalyticsReadAdapterOptions): AnalyticsReadPort {
  const client: InternalServiceClient = createInternalServiceClient({
    ...options,
    fetchImpl: options.fetchImpl ? ((input, init) => options.fetchImpl!(input as string | URL, init)) as typeof fetch : undefined,
  });

  return {
    getAnalytics: async ({ principal, months, requestId }): Promise<OperatorAnalyticsResponse> => {
      const path = '/internal/operator/v1/analytics';
      // Only normalized contract values are serialized and bound into the signed assertion.
      const query = new URLSearchParams({ months: String(months) }).toString();
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
          throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.', cause);
        }
        throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.', cause);
      }
      if (response.status !== 200 || response.data === null) {
        throw dependencyError('DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.');
      }
      const envelope = responseEnvelope.safeParse(response.data);
      if (!envelope.success || envelope.data.request_id !== requestId) {
        throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      }
      const data = operatorAnalyticsResponse.safeParse(envelope.data.data);
      if (!data.success || data.data.period.months !== months) {
        throw dependencyError('DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      }
      return data.data;
    },
  };
}
