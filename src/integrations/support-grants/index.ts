import { z } from 'zod';
import { AppError } from '../../errors.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../internal-service-client.js';
import { supportGrantProjectionSchema, type SupportGrantCommandPort, type SupportGrantCreateInput } from '../../operator-support/index.js';

export type SupportGrantCommandAdapterOptions = { baseUrl: string; serviceAuth: (requestId: string) => string | Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number; allowInsecureTransport?: boolean };
const envelope = z.object({ success: z.literal(true), data: z.unknown() }).strict();
const idempotency = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
function projection(value: unknown) { const parsed = envelope.safeParse(value); if (!parsed.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business command service returned an invalid response.'); const result = supportGrantProjectionSchema.safeParse(parsed.data.data); if (!result.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business command service returned an invalid response.'); return result.data; }
export function createSupportGrantCommandAdapter(options: SupportGrantCommandAdapterOptions): SupportGrantCommandPort {
  const client: InternalServiceClient = createInternalServiceClient(options);
  const call = async (path: string, body: unknown, requestId: string, key: string) => { if (!idempotency.safeParse(key).success) throw new AppError(400, 'VALIDATION_FAILED', 'A valid idempotency key is required.'); try { const response = await client.requestJsonResponse<unknown>(path, { requestId, method: 'POST', body, headers: { 'Idempotency-Key': key } }, [200, 201, 202]); if (response.data === null) throw new Error('missing'); return projection(response.data); } catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The business command service is unavailable.'); } };
  return {
    createSupportGrant: async (input: SupportGrantCreateInput & { operatorSubject: string; idempotencyKey: string; requestId: string }) => call('/internal/operator/v1/support-grants', { tenant_id: input.tenant_id, permission_codes: input.permission_codes, reason: input.reason, starts_at: input.starts_at, expires_at: input.expires_at, operator_subject: input.operatorSubject }, input.requestId, input.idempotencyKey),
    revokeSupportGrant: async (input) => call(`/internal/operator/v1/support-grants/${encodeURIComponent(input.grantId)}/revoke`, { operator_subject: input.operatorSubject }, input.requestId, input.idempotencyKey),
  };
}
