import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createBusinessReadAdapter } from '../src/integrations/business-read/index.js';
import type { SafeOperatorPrincipal } from '../src/operator-auth.js';

const iso = '2026-01-01T00:00:00.000Z';
const overview = {
  as_of: iso,
  businesses: { total: 1, by_status: [{ status: 'active', count: 1 }, { status: 'restricted', count: 0 }, { status: 'cancelled', count: 0 }] },
  subscriptions: { active: 1, trial: 0, grace: 0, past_due: 0, restricted: 0, cancelled: 0, missing: 0, lifecycle: { expired_trials: 0, expired_grace: 0, incomplete_trials: 0, incomplete_grace: 0 } },
  attention: { failed_jobs: 0, failed_notifications: 0, active_support_grants: 0 },
  recent_businesses: [],
};
const secret = 'test-assertion-secret-with-more-than-32-bytes';
const principal: SafeOperatorPrincipal = { clerkUserId: 'user_clerk_123', operatorOrganizationId: 'org_operator_exact', roles: ['read_only_operator'], requestId: 'req-1' };
const ownerPrincipal: SafeOperatorPrincipal = { clerkUserId: 'user_clerk_123', operatorOrganizationId: 'org_operator_exact', roles: ['platform_owner'], requestId: 'req-1' };
const overviewInput = { principal, requestId: 'req-1' };

function response(body: unknown, status = 200): Response {
  const normalized = typeof body === 'object' && body !== null && 'success' in body && (body as { success?: unknown }).success === true
    ? { ...(body as Record<string, unknown>), request_id: (body as Record<string, unknown>).request_id ?? 'req-1' }
    : body;
  return new Response(JSON.stringify(normalized), { status, headers: { 'content-type': 'application/json' } });
}

describe('business read adapter', () => {
  it('signs a request-bound assertion and validates the current overview contract', async () => {
    let authenticatedRequestId = ''; const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://business.test/internal/operator/v1/overview');
      const headers = init?.headers as Record<string, string>;
      expect(headers).toEqual(expect.objectContaining({ Accept: 'application/json', 'X-Request-ID': 'req-1', Authorization: 'Bearer internal' }));
      expect(Object.keys(headers).sort()).toEqual(['Accept', 'Authorization', 'X-Drezivo-Operator-Assertion', 'X-Request-ID'].sort());
      const token = headers['X-Drezivo-Operator-Assertion']!;
      const [headerPart, claimsPart, signature] = token.split('.');
      expect(JSON.parse(Buffer.from(headerPart!, 'base64url').toString('utf8'))).toEqual({ alg: 'HS256', typ: 'JWT' });
      const claims = JSON.parse(Buffer.from(claimsPart!, 'base64url').toString('utf8')) as Record<string, unknown>;
      const expectedSignature = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${headerPart}.${claimsPart}`).digest('base64url');
      expect(signature).toBe(expectedSignature);
      expect(claims).toMatchObject({ iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'user_clerk_123', org_id: 'org_operator_exact', role: 'read_only_operator', permission: 'operator.overview.read', method: 'GET', path: '/internal/operator/v1/overview', request_id: 'req-1' });
      expect(claims.exp).toBe((claims.iat as number) + 60);
      expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/i);
      expect(new URL(String(url)).search).toBe('');
      return response({ success: true, data: overview, request_id: 'req-1' });
    });
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async (requestId) => { authenticatedRequestId = requestId; return 'Bearer internal'; }, operatorAssertionSecret: secret, fetchImpl }).overview(overviewInput)).resolves.toEqual(overview); expect(authenticatedRequestId).toBe('req-1');
  });

  it('rejects flattened subscription lifecycle counts that do not match the shared contract', async () => {
    const { lifecycle, ...subscriptionCounts } = overview.subscriptions;
    const flattenedOverview = { ...overview, subscriptions: { ...subscriptionCounts, ...lifecycle } };
    const fetchImpl = vi.fn(async () => response({ success: true, data: flattenedOverview, request_id: 'req-1' }));
    const adapter = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl });
    await expect(adapter.overview(overviewInput)).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('fails closed without making a request when the assertion secret is missing or too short', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: overview }));
    const missing = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', fetchImpl });
    const tooShort = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: 'not-enough-bytes', fetchImpl });
    await expect(missing.overview(overviewInput)).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' });
    await expect(tooShort.overview(overviewInput)).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps timeout to a safe dependency error', async () => {
    const fetchImpl = vi.fn((_url: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, timeoutMs: 250, fetchImpl }).overview(overviewInput)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('preserves service auth failures and does not make a request', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: overview }));
    const thrown = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => { throw new Error('secret'); }, fetchImpl });
    const invalid = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => '', fetchImpl });
    await expect(thrown.overview(overviewInput)).rejects.toMatchObject({ status: 503, code: 'OPERATOR_AUTH_UNAVAILABLE' });
    await expect(invalid.overview(overviewInput)).rejects.toMatchObject({ status: 503, code: 'OPERATOR_AUTH_UNAVAILABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed downstream payloads without exposing details', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: { as_of: 'bad' } }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl }).overview(overviewInput)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_INVALID_RESPONSE', message: 'The business read service returned an invalid response.' });
  });

  it('rejects a successful envelope correlated to another request', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: overview, request_id: 'other-request' }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl }).overview(overviewInput)).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('maps downstream failures without returning raw body text', async () => {
    const fetchImpl = vi.fn(async () => response({ secret: 'must not escape' }, 500));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl }).overview(overviewInput)).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', message: 'The business read service is unavailable.' });
  });

  it('maps list filters and cursor to the approved query contract', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/internal/operator/v1/businesses');
      expect(parsed.searchParams.get('q')).toBe('shop');
      expect(parsed.searchParams.getAll('status')).toEqual(['active', 'restricted']);
      expect(parsed.searchParams.get('plan_code')).toBe('professional');
      expect(parsed.searchParams.get('limit')).toBe('10');
      expect(parsed.searchParams.has('sort')).toBe(false);
      const cursor = JSON.parse(Buffer.from(parsed.searchParams.get('cursor')!, 'base64url').toString('utf8'));
      expect(cursor).toEqual({ createdAt: iso, id: '550e8400-e29b-41d4-a716-446655440000' });
      return response({ success: true, data: { items: [], next_cursor: null } });
    });
    await createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl }).listBusinesses({
      principal: ownerPrincipal,
      filters: { q: 'shop', status: ['active', 'restricted'], plan_code: 'professional', sort: 'created_at_desc' },
      limit: 10,
      cursor: { createdAt: iso, tenantId: '550e8400-e29b-41d4-a716-446655440000' }, requestId: 'req-1',
    });
  });

  it('strictly maps the business list and detail wire projections into the Operator API contract', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const wireCursor = Buffer.from(JSON.stringify({ createdAt: iso, id: tenantId }), 'utf8').toString('base64url');
    const business = { id: tenantId, name: 'Drezivo Shop', slug: 'drezivo-shop', status: 'active', currency: 'PHP', timezone: 'Asia/Manila', created_at: iso, updated_at: iso, plan_code: 'professional', subscription_status: 'active', current_period_end: iso, cancel_at_period_end: false, branch_count: 1, active_membership_count: 2 };
    const detail = { business: { id: tenantId, name: 'Drezivo Shop', slug: 'drezivo-shop', status: 'active', currency: 'PHP', timezone: 'Asia/Manila', created_at: iso, updated_at: iso }, branches: [{ id: tenantId, name: 'Main', code: 'MAIN', is_default: true, timezone: 'Asia/Manila', status: 'active', created_at: iso }], membership_counts: { active: 2, suspended: 0, removed: 1, invited: 1 }, subscription: { plan_code: 'professional', status: 'active', current_period_start: iso, current_period_end: iso, trial_ends_at: null, grace_ends_at: null, cancel_at_period_end: false }, entitlements: { enabled_capability_count: 2, disabled_capability_count: 0, overridden_capability_count: 0 } };
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(String(url));
      const token = (init?.headers as Record<string, string>)['X-Drezivo-Operator-Assertion']!;
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
      expect(claims.request_id).toBe('req-1');
      if (parsed.pathname.endsWith('/entitlements')) {
        expect(claims).toMatchObject({ permission: 'operator.entitlements.read', tenant_id: tenantId, path: parsed.pathname });
        return response({ success: true, data: { tenant_id: tenantId, plan_code: 'professional', plan_version: 1, source: 'plan_definition', capability_count: 2, capabilities: [{ capability: 'physical_assets.max', enabled: true, limit_value: 10 }, { capability: 'frontdesk_seats.max', enabled: true, limit_value: 2 }] }, request_id: 'req-1' });
      }
      if (parsed.pathname === `/internal/operator/v1/businesses/${tenantId}`) {
        expect(claims).toMatchObject({ permission: 'operator.business.detail.read', tenant_id: tenantId, path: parsed.pathname });
        return response({ success: true, data: detail, request_id: 'req-1' });
      }
      expect(claims).toMatchObject({ permission: 'operator.business.list.read', path: parsed.pathname });
      return response({ success: true, data: { items: [business], next_cursor: wireCursor }, request_id: 'req-1' });
    });
    const adapter = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl });
    await expect(adapter.listBusinesses({ principal: ownerPrincipal, filters: { status: [], sort: 'created_at_desc' }, limit: 10, cursor: null, requestId: 'req-1' })).resolves.toEqual({
      items: [{ tenant_id: tenantId, business_name: 'Drezivo Shop', slug: 'drezivo-shop', status: 'active', currency: 'PHP', timezone: 'Asia/Manila', created_at: iso, updated_at: iso, branch_count: 1, active_member_count: 2, subscription: { plan_code: 'professional', status: 'active', current_period_end: iso, cancel_at_period_end: false } }],
      next_cursor: { createdAt: iso, tenantId },
    });
    await expect(adapter.getBusiness({ principal: ownerPrincipal, tenantId, requestId: 'req-1' })).resolves.toMatchObject({ tenant_id: tenantId, branches: [{ branch_id: tenantId }], membership_summary: { active_count: 2, invited_count: 1, suspended_count: 0 }, entitlement_summary: { capability_count: 2, overridden_capability_count: 0 } });
    const wrongTenant = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl: async () => response({ success: true, data: { ...detail, business: { ...detail.business, id: '00000000-0000-4000-8000-000000000001' } } }) });
    await expect(wrongTenant.getBusiness({ principal: ownerPrincipal, tenantId, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('rejects unknown fields in successful business projections', async () => {
    const fetchImpl = vi.fn(async () => response({ success: true, data: { items: [{ id: '550e8400-e29b-41d4-a716-446655440000', unexpected: true }], next_cursor: null } }));
    const adapter = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl });
    await expect(adapter.listBusinesses({ principal: ownerPrincipal, filters: { status: [], sort: 'created_at_desc' }, limit: 10, cursor: null, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('returns null for a missing business detail', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl }).getBusiness({ principal: ownerPrincipal, tenantId: '550e8400-e29b-41d4-a716-446655440000', requestId: 'req-1' })).resolves.toBeNull();
  });

  it('maps overview and list 404 responses to dependency unavailable', async () => {
    const fetchImpl = vi.fn(async () => response({}, 404));
    const adapter = createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl });
    await expect(adapter.overview(overviewInput)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(adapter.listBusinesses({ principal: ownerPrincipal, filters: { status: [], sort: 'created_at_desc' }, limit: 10, cursor: null, requestId: 'req-1' })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('rejects missing and non-JSON content types safely', async () => {
    const missing = vi.fn(async () => new Response(JSON.stringify({ success: true, data: overview }), { status: 200 }));
    const html = vi.fn(async () => new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl: missing }).overview(overviewInput)).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    await expect(createBusinessReadAdapter({ baseUrl: 'https://business.test', serviceAuth: async () => 'Bearer internal', operatorAssertionSecret: secret, fetchImpl: html }).overview(overviewInput)).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('rejects invalid base URLs with a safe dependency error', () => {
    expect(() => createBusinessReadAdapter({ baseUrl: 'ftp://business.test', serviceAuth: async () => 'Bearer internal' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
    expect(() => createBusinessReadAdapter({ baseUrl: 'not a url', serviceAuth: async () => 'Bearer internal' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
    expect(() => createBusinessReadAdapter({ baseUrl: 'http://business.test', serviceAuth: async () => 'Bearer internal' })).toThrowError(expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }));
  });
});
