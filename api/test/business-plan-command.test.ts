import { describe, expect, it, vi } from 'vitest';

import type { TenantDetail } from '../src/features/clients/administration/contracts.js';
import { createBusinessPlanCommandAdapter } from '../src/features/clients/administration/repository/business-plan-command.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const requestId = 'plan-request-1';
const detail: TenantDetail = {
  tenant_id: tenantId,
  name: 'Luna Gowns',
  slug: 'luna-gowns',
  status: 'active',
  timezone: 'Asia/Manila',
  created_at: '2026-09-20T02:00:00.000Z',
  subscription: { status: 'trialing', plan_code: 'standard', trial_ends_at: '2026-11-01T00:00:00.000Z', grace_ends_at: null, current_period_end: null },
  member_counts: { active: 1, suspended: 0, removed: 0 },
  pending_payment: false,
  members: [],
  recent_audit: [],
  notes: [],
  payments: [],
};

describe('Business API plan command adapter', () => {
  it.each(['starter', 'standard', 'growth', 'scale'] as const)(
    'sends a signed, idempotent %s command and refreshes tenant details without a reason',
    async (planCode) => {
    let sentUrl = '';
    let sentInit: RequestInit | undefined;
    const refreshedDetail: TenantDetail = {
      ...detail,
      subscription: { ...detail.subscription!, plan_code: planCode },
    };
    const adapter = createBusinessPlanCommandAdapter({
      baseUrl: 'https://business.example/',
      serviceAuth: () => 'Bearer operator-service-token',
      operatorAssertionSecret: 'operator-assertion-secret-that-is-at-least-thirty-two-bytes',
      fetchImpl: async (input, init) => {
        sentUrl = String(input);
        sentInit = init;
        return new Response(JSON.stringify({
          success: true,
          request_id: requestId,
          data: { tenant_id: tenantId, plan_code: planCode, changed: true, replayed: false },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }, { getTenant: vi.fn().mockResolvedValue(refreshedDetail) });

    const result = await adapter.changeSubscriptionPlan(tenantId, planCode, {
      operatorSubject: 'user_operator',
      idempotencyKey: 'operator-plan-request-1',
      requestId,
      reason: null,
      operatorOrganizationId: 'org_operator',
      operatorRole: 'platform_owner',
    });

    expect(sentUrl).toBe(`https://business.example/internal/operator/v1/tenants/${tenantId}/plan`);
    expect(sentInit?.method).toBe('POST');
    expect(JSON.parse(String(sentInit?.body))).toEqual({ plan_code: planCode });
    const headers = new Headers(sentInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer operator-service-token');
    expect(headers.get('idempotency-key')).toBe('operator-plan-request-1');
    expect(headers.get('x-request-id')).toBe(requestId);
    const assertion = headers.get('x-drezivo-operator-assertion');
    if (!assertion) throw new Error('The operator assertion was not sent.');
    const encodedClaims = assertion.split('.')[1];
    if (!encodedClaims) throw new Error('The operator assertion has no claims.');
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: 'user_operator',
      org_id: 'org_operator', role: 'platform_owner', permission: 'tenant.admin.manage',
      tenant_id: tenantId, request_id: requestId, idempotency_key: 'operator-plan-request-1',
    });
    expect(result).toMatchObject({ tenant: refreshedDetail, changed: true, replayed: false });
    },
  );
});
