import { describe, expect, it, vi } from 'vitest';
import { createBusinessReadAdapter } from '../src/integrations/business-read/index.js';

const iso = '2026-01-01T00:00:00.000Z';
const overview = {
  as_of: iso,
  businesses: { total: 1, by_status: [{ status: 'active', count: 1 }] },
  subscriptions: { active: 1, trial: 0, grace: 0, past_due: 0 },
  attention: { failed_jobs: 0, failed_notifications: 0, pending_support_grants: 0 },
  recent_signups: [],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('business read adapter', () => {
  it('passes auth and validates a successful overview envelope', async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://business.test/internal/operator/v1/overview');
      expect(init?.headers).toEqual({ authorization: 'Bearer internal', accept: 'application/json' });
      return response({ success: true, data: overview, request_id: 'ignored' });
    });
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', requestAuth: 'Bearer internal', fetchImpl }).overview({ asOf: undefined })).resolves.toEqual(overview);
  });

  it('maps timeout to a safe dependency error', async () => {
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', timeoutMs: 5, fetchImpl }).overview({ asOf: undefined })).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('rejects malformed downstream payloads without exposing details', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: { as_of: 'bad' } }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl }).overview({ asOf: undefined })).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_INVALID_RESPONSE', message: 'The business read service returned an invalid response.' });
  });

  it('maps downstream failures without returning raw body text', async () => {
    const fetchImpl = vi.fn(async () => response({ secret: 'must not escape' }, 500));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl }).overview({ asOf: undefined })).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', message: 'The business read service is unavailable.' });
  });

  it('maps list filters and cursor to the approved query contract', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/internal/operator/v1/businesses');
      expect(parsed.searchParams.get('q')).toBe('shop');
      expect(parsed.searchParams.getAll('status')).toEqual(['active', 'restricted']);
      expect(parsed.searchParams.get('plan_code')).toBe('professional');
      expect(parsed.searchParams.get('sort')).toBe('created_at_desc');
      expect(parsed.searchParams.get('limit')).toBe('10');
      expect(parsed.searchParams.get('cursor_created_at')).toBe(iso);
      expect(parsed.searchParams.get('cursor_tenant_id')).toBe('550e8400-e29b-41d4-a716-446655440000');
      return response({ success: true, data: { items: [], next_cursor: null } });
    });
    await createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl }).listBusinesses({
      filters: { q: 'shop', status: ['active', 'restricted'], plan_code: 'professional', sort: 'created_at_desc' },
      limit: 10,
      cursor: { createdAt: iso, tenantId: '550e8400-e29b-41d4-a716-446655440000' },
    });
  });

  it('returns null for a missing business detail', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl }).getBusiness({ tenantId: '550e8400-e29b-41d4-a716-446655440000' })).resolves.toBeNull();
  });

  it('maps overview and list 404 responses to dependency unavailable', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    const adapter = createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl });
    await expect(adapter.overview({ asOf: undefined })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(adapter.listBusinesses({ filters: { status: [], sort: 'created_at_desc' }, limit: 10, cursor: null })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('rejects missing and non-JSON content types safely', async () => {
    const missing = vi.fn(async () => new Response(JSON.stringify({ success: true, data: overview }), { status: 200 }));
    const html = vi.fn(async () => new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl: missing }).overview({ asOf: undefined })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', fetchImpl: html }).overview({ asOf: undefined })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('rejects invalid base URLs with a safe dependency error', () => {
    expect(() => createBusinessReadAdapter({ baseUrl: 'ftp://business.test' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
    expect(() => createBusinessReadAdapter({ baseUrl: 'not a url' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
    expect(() => createBusinessReadAdapter({ baseUrl: 'http://business.test' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
  });
});
