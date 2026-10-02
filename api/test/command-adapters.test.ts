import { describe, expect, it } from 'vitest';
import { createSupportGrantCommandAdapter } from '../src/integrations/support-grants/index.js';
import { createOperationsRetryAdapter } from '../src/integrations/operations-retry/index.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const grantId = '650e8400-e29b-41d4-a716-446655440000';
const key = 'intent-1234567890';
const projection = { grant_id: grantId, tenant_id: tenantId, operator_subject: 'operator-1', permission_codes: ['business.read'], starts_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-02T00:00:00.000Z', revoked_at: null, created_at: '2026-01-01T00:00:00.000Z' };
const retry = { command_kind: 'job.retry', resource_id: grantId, status: 'accepted', request_id: 'req-1', accepted_at: '2026-01-01T00:00:00.000Z' };
const response = (body: unknown, status = 202) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('configured command adapters', () => {
  it('sends exact support grant wire fields and idempotency header', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => { expect(String(url)).toBe('https://business.test/internal/operator/v1/support-grants'); expect(init?.headers).toEqual({ Accept: 'application/json', 'X-Request-ID': 'req-1', Authorization: 'Bearer internal', 'Idempotency-Key': key, 'Content-Type': 'application/json' }); expect(JSON.parse(String(init?.body))).toEqual({ tenant_id: tenantId, permission_codes: ['business.read'], reason: 'Investigate issue', starts_at: projection.starts_at, expires_at: projection.expires_at, operator_subject: 'operator-1' }); return response({ success: true, data: projection }, 201); };
    const adapter = createSupportGrantCommandAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl });
    await expect(adapter.createSupportGrant({ tenant_id: tenantId, permission_codes: ['business.read'], reason: 'Investigate issue', starts_at: projection.starts_at, expires_at: projection.expires_at, operatorSubject: 'operator-1', idempotencyKey: key, requestId: 'req-1' })).resolves.toEqual(projection);
  });

  it('sends exact retry wire fields and maps unsafe responses safely', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => { expect(String(url)).toBe(`https://business.test/internal/operator/v1/jobs/${grantId}/retry`); expect(init?.headers).toMatchObject({ 'Idempotency-Key': key }); expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Retry after inspection', operator_subject: 'operator-1' }); return response({ success: true, data: retry }); };
    const adapter = createOperationsRetryAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl });
    await expect(adapter.retryJob({ jobId: grantId, reason: 'Retry after inspection', operatorSubject: 'operator-1', idempotencyKey: key, requestId: 'req-1' })).resolves.toEqual(retry);
    const malformed = createOperationsRetryAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl: async () => response({ success: true, data: { ...retry, provider_token: 'secret' } }) });
    await expect(malformed.retryJob({ jobId: grantId, reason: 'Retry after inspection', operatorSubject: 'operator-1', idempotencyKey: key, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
