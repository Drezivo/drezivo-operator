import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBillingReadAdapter } from '../src/integrations/billing-read/index.js';
import type { SafeOperatorPrincipal } from '../src/operator-auth.js';

const tenantId = '550e8400-e29b-41d4-a716-446655440000';
const requestId = 'req-1';
const secret = 'operator-assertion-test-secret-over-32-bytes';
const principal: SafeOperatorPrincipal = { clerkUserId: 'user_clerk_123', operatorOrganizationId: 'org_operator_exact', roles: ['platform_owner'], requestId };
const subscriptionWire = { id: tenantId, name: 'Drezivo Shop', plan_code: 'professional', status: 'active', currency: 'PHP', current_period_start: '2026-01-01T00:00:00.000Z', current_period_end: '2026-02-01T00:00:00.000Z', cancel_at_period_end: false };
const subscriptionPublic = { tenant_id: tenantId, business_name: 'Drezivo Shop', plan_code: 'professional', status: 'active', currency: 'PHP', current_period_start: subscriptionWire.current_period_start, current_period_end: subscriptionWire.current_period_end, cancel_at_period_end: false };
const entitlementWire = { tenant_id: tenantId, plan_code: 'professional', plan_version: 1, source: 'plan_definition', capability_count: 2, capabilities: [{ capability: 'physical_assets.max', enabled: true, limit_value: 100 }, { capability: 'frontdesk_seats.max', enabled: true, limit_value: 5 }] };
const entitlementPublic = { tenant_id: tenantId, plan_code: 'professional', capability_count: 2, overridden_capability_count: 0, capabilities: entitlementWire.capabilities };
const response = (data: unknown, status = 200, contentType = 'application/json') => {
  const body = typeof data === 'object' && data !== null && 'success' in data && (data as { success?: unknown }).success === true
    ? { ...(data as Record<string, unknown>), request_id: (data as Record<string, unknown>).request_id ?? requestId }
    : data;
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
};
const base = (fetchImpl: typeof fetch) => ({ baseUrl: 'https://business.test/', serviceAuth: async (id: string) => { expect(id).toBe(requestId); return 'Bearer internal'; }, operatorAssertionSecret: secret, fetchImpl });

function claimsFrom(init: RequestInit | undefined): Record<string, unknown> {
  const headers = init?.headers as Record<string, string>;
  const token = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-drezivo-operator-assertion')?.[1]!;
  const [h, p, sig] = token.split('.');
  expect(sig).toBe(createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${h}.${p}`).digest('base64url'));
  return JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('billing read adapter', () => {
  it('signs the subscription request and maps the strict business projection to the public contract', async () => {
    let seen: Request | undefined;
    const adapter = createBillingReadAdapter(base(async (input, init) => { seen = new Request(input, init); return response({ success: true, data: { items: [subscriptionWire], next_cursor: null }, request_id: requestId }); }));
    await expect(adapter.listSubscriptions({ principal, filters: { plan_code: 'professional', status: 'active' }, limit: 10, cursor: null, requestId })).resolves.toEqual({ items: [subscriptionPublic], next_cursor: null });
    expect(seen!.url).toBe('https://business.test/internal/operator/v1/subscriptions?limit=10&plan_code=professional&status=active');
    expect(seen!.headers.get('authorization')).toBe('Bearer internal');
    expect(seen!.headers.get('x-request-id')).toBe(requestId);
    expect(claimsFrom({ headers: Object.fromEntries(seen!.headers.entries()) })).toMatchObject({ sub: principal.clerkUserId, role: 'platform_owner', permission: 'operator.subscription.list.read', method: 'GET', path: '/internal/operator/v1/subscriptions', request_id: requestId });
  });

  it('binds entitlement assertions to the route tenant and maps only approved fields', async () => {
    let seen: Request | undefined;
    const adapter = createBillingReadAdapter(base(async (input, init) => { seen = new Request(input, init); return response({ success: true, data: entitlementWire, request_id: requestId }); }));
    await expect(adapter.getEntitlements({ principal, tenantId, requestId })).resolves.toEqual(entitlementPublic);
    expect(new URL(seen!.url).pathname).toBe(`/internal/operator/v1/businesses/${tenantId}/entitlements`);
    expect(claimsFrom({ headers: Object.fromEntries(seen!.headers.entries()) })).toMatchObject({ permission: 'operator.entitlements.read', tenant_id: tenantId, path: `/internal/operator/v1/businesses/${tenantId}/entitlements` });
  });

  it('rejects tenant mismatches and unknown upstream fields', async () => {
    const mismatch = createBillingReadAdapter(base(async () => response({ success: true, data: { ...entitlementWire, tenant_id: '00000000-0000-4000-8000-000000000001' } })));
    await expect(mismatch.getEntitlements({ principal, tenantId, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    const extra = createBillingReadAdapter(base(async () => response({ success: true, data: { items: [{ ...subscriptionWire, provider_reference: 'private' }], next_cursor: null } } )));
    await expect(extra.listSubscriptions({ principal, filters: {}, limit: 25, cursor: null, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('preserves the approved not-found mapping and hides upstream failures', async () => {
    const missing = createBillingReadAdapter(base(async () => response({}, 404)));
    await expect(missing.getEntitlements({ principal, tenantId, requestId })).resolves.toBeNull();
    const failed = createBillingReadAdapter(base(async () => response({ secret: 'private' }, 502)));
    await expect(failed.getEntitlements({ principal, tenantId, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('rejects a successful envelope correlated to another request', async () => {
    const adapter = createBillingReadAdapter(base(async () => response({ success: true, data: { items: [subscriptionWire], next_cursor: null }, request_id: 'other-request' })));
    await expect(adapter.listSubscriptions({ principal, filters: {}, limit: 10, cursor: null, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });
});
