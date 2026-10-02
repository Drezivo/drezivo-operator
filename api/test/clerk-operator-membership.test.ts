import { describe, expect, it, vi } from 'vitest';
import { createClerkOperatorMembershipReader } from '../src/clerk-operator-membership.js';
import { createClerkAuthorizationPort } from '../src/operator-authorization.js';
import type { SafeOperatorPrincipal } from '../src/operator-auth.js';
import type { Request } from 'express';

const organizationId = 'org_operator';
const userId = 'user_operator';
const membership = {
  organizationId,
  publicUserData: { userId },
  role: 'org:platform_owner',
};

describe('Clerk operator membership', () => {
  it('checks the exact organization and user and maps only an approved role', async () => {
    const listMemberships = vi.fn(async () => ({ data: [membership] }));
    const reader = createClerkOperatorMembershipReader({ organizationId, listMemberships });

    await expect(reader(userId)).resolves.toEqual({ active: true, roles: ['org:platform_owner'] });
    expect(listMemberships).toHaveBeenCalledWith({ organizationId, userId: [userId], limit: 2 });
  });

  it('fails closed for missing, mismatched, duplicate, or unknown memberships', async () => {
    const row = (overrides: Record<string, unknown> = {}) => ({ ...membership, ...overrides });
    for (const response of [
      { data: [] },
      { data: [row({ organizationId: 'org_business' })] },
      { data: [row({ publicUserData: { userId: 'user_other' } })] },
      { data: [row({ publicUserData: undefined })] },
      { data: [row({ role: 'org:admin' })] },
      { data: [row(), row()] },
      { unexpected: [] },
    ]) {
      const reader = createClerkOperatorMembershipReader({ organizationId, listMemberships: async () => response });
      await expect(reader(userId)).resolves.toMatchObject({ active: false });
    }
  });

  it('maps Clerk outages and timeouts to a safe provider failure', async () => {
    const failed = createClerkOperatorMembershipReader({ organizationId, listMemberships: async () => { throw new Error('private provider detail'); } });
    const hanging = createClerkOperatorMembershipReader({ organizationId, timeoutMs: 5, listMemberships: () => new Promise(() => {}) });

    await expect(failed(userId)).resolves.toEqual({ active: false, reason: 'provider_unavailable' });
    await expect(hanging(userId)).resolves.toEqual({ active: false, reason: 'provider_unavailable' });
  });

  it('keeps role permissions narrow and grants full operator access only to platform owners', async () => {
    const port = createClerkAuthorizationPort({ organizationId, listMemberships: async () => ({ data: [membership] }) });
    const resolved = await port.resolveMembership({ clerkUserId: userId, operatorOrganizationId: organizationId });
    expect(resolved).toEqual({ active: true, roles: ['platform_owner'] });
    const principal: SafeOperatorPrincipal = { clerkUserId: userId, operatorOrganizationId: organizationId, roles: ['platform_owner'], requestId: 'req' };
    const request = {} as Request;
    await expect(port.resolvePermission({ principal, permission: 'support.grant.create', request })).resolves.toBe(true);
    await expect(port.resolveTenantScope({ principal, tenantId: '550e8400-e29b-41d4-a716-446655440000', request })).resolves.toBe(true);

    const operatorPort = createClerkAuthorizationPort({
      organizationId,
      listMemberships: async () => ({ data: [{ ...membership, role: 'org:platform_operator' }] }),
    });
    const operator: SafeOperatorPrincipal = { ...principal, roles: ['platform_operator'] };
    await expect(operatorPort.resolvePermission({ principal: operator, permission: 'operator.overview.read', request })).resolves.toBe(true);
    await expect(operatorPort.resolvePermission({ principal: operator, permission: 'business.summary.read', request })).resolves.toBe(false);
    await expect(operatorPort.resolveTenantScope({ principal: operator, tenantId: '550e8400-e29b-41d4-a716-446655440000', request })).resolves.toBe(false);
  });

  it('grants platform analytics only to the approved platform owner and billing roles', async () => {
    const request = {} as Request;
    for (const [clerkRole, operatorRole, allowed] of [
      ['org:platform_owner', 'platform_owner', true],
      ['org:billing_operator', 'billing_operator', true],
      ['org:platform_operator', 'platform_operator', false],
      ['org:support_operator', 'support_operator', false],
      ['org:read_only_operator', 'read_only_operator', false],
    ] as const) {
      const port = createClerkAuthorizationPort({ organizationId, listMemberships: async () => ({ data: [{ ...membership, role: clerkRole }] }) });
      const principal: SafeOperatorPrincipal = { clerkUserId: userId, operatorOrganizationId: organizationId, roles: [operatorRole], requestId: 'req' };
      await expect(port.resolvePermission({ principal, permission: 'platform.analytics.read', request })).resolves.toBe(allowed);
    }
  });
});
