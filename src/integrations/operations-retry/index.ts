import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { retryResultSchema, type OperationsRetryCommandPort, type RetryRequest } from '../../operator-retry/index.js';
export type OperationsRetryAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown() }).strict();
const idempotency = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
export function createOperationsRetryAdapter(options: OperationsRetryAdapterOptions): OperationsRetryCommandPort {
  const client: InternalServiceClient = createInternalServiceClient(options);
  const call = async (path: string, body: unknown, requestId: string, key: string) => { if (!idempotency.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.'); try { const response = await client.requestJsonResponse<unknown>(path, { requestId, method: 'POST', body, headers: { 'Idempotency-Key': key } }, [200, 202]); if (response.data === null) throw new Error('missing'); const outer = envelope.safeParse(response.data); if (!outer.success) throw new Error('envelope'); const result = retryResultSchema.safeParse(outer.data.data); if (!result.success) throw new Error('projection'); return result.data; } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); } };
  return {
    retryJob: async (input: RetryRequest & { jobId: string; operatorSubject: string; idempotencyKey: string; requestId: string }) => call(`/internal/operator/v1/jobs/${encodeURIComponent(input.jobId)}/retry`, { reason: input.reason, operator_subject: input.operatorSubject }, input.requestId, input.idempotencyKey),
    retryNotification: async (input) => call(`/internal/operator/v1/notifications/${encodeURIComponent(input.deliveryId)}/retry`, { reason: input.reason, operator_subject: input.operatorSubject }, input.requestId, input.idempotencyKey),
  };
}
