import { describe, expect, it } from 'vitest';
import { createOperationsRetryAdapter } from '../src/features/operations/repository/retry-internal.js';

const jobId = '650e8400-e29b-41d4-a716-446655440000';
const key = 'local-test-test-1';
const retry = { command_kind: 'job.retry', resource_id: jobId, status: 'accepted', request_id: 'req-1', accepted_at: '2026-01-01T00:00:00.000Z' };
const response = (body: unknown, status = 202) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('configured command adapters', () => {
  it('sends exact retry wire fields and maps unsafe responses safely', async () => {
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => { expect(String(url)).toBe(`https://business.test/internal/operator/v1/jobs/${jobId}/retry`); expect(init?.headers).toMatchObject({ 'Idempotency-Key': key }); expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Retry after inspection', operator_subject: 'operator-1' }); return response({ success: true, data: retry }); };
    const adapter = createOperationsRetryAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl });
    await expect(adapter.retryJob({ jobId, reason: 'Retry after inspection', operatorSubject: 'operator-1', idempotencyKey: key, requestId: 'req-1' })).resolves.toEqual(retry);
    const malformed = createOperationsRetryAdapter({ baseUrl: 'https://business.test/', serviceAuth: () => 'Bearer internal', fetchImpl: async () => response({ success: true, data: { ...retry, provider_token: 'secret' } }) });
    await expect(malformed.retryJob({ jobId, reason: 'Retry after inspection', operatorSubject: 'operator-1', idempotencyKey: key, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
