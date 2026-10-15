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
      { data: [row({ role: 'org:billing' })] },
      { data: [row({ role: 'admin' })] },
      { data: [row(), row()] },
      { unexpected: [] },
    ]) {
      const reader = createClerkOperatorMembershipReader({ organizationId, listMemberships: async () => response });
      await expect(reader(userId)).resolves.toMatchObject({ active: false });
    }
  });

  it('grants Superadmin only to the dedicated organization admin or owner', async () => {
    for (const role of ['org:admin','org:platform_owner']) {
      const port=createClerkAuthorizationPort({organizationId,listMemberships:async()=>({data:[{...membership,role}]})});
      await expect(port.resolveMembership({clerkUserId:userId,operatorOrganizationId:organizationId})).resolves.toEqual({active:true,roles:['platform_owner']});
    }
    for (const role of ['org:member','org:platform_operator','org:support_operator','org:billing_operator','org:read_only_operator']) {
      const port=createClerkAuthorizationPort({organizationId,listMemberships:async()=>({data:[{...membership,role}]})});
      await expect(port.resolveMembership({clerkUserId:userId,operatorOrganizationId:organizationId})).resolves.toEqual({active:false,roles:[]});
    }
  });

  it('maps Clerk outages and timeouts to a safe provider failure', async () => {
    const failed = createClerkOperatorMembershipReader({ organizationId, listMemberships: async () => { throw new Error('private provider detail'); } });
    const hanging = createClerkOperatorMembershipReader({ organizationId, timeoutMs: 5, listMemberships: () => new Promise(() => {}) });

    await expect(failed(userId)).resolves.toEqual({ active: false, reason: 'provider_unavailable' });
    await expect(hanging(userId)).resolves.toEqual({ active: false, reason: 'provider_unavailable' });
  });

  it('denies legacy specialist principals and unknown permissions', async()=>{
    const port=createClerkAuthorizationPort({organizationId,listMemberships:async()=>({data:[membership]})});
    const principal:SafeOperatorPrincipal={clerkUserId:userId,operatorOrganizationId:organizationId,roles:['platform_owner'],requestId:'req'};
    const request={} as Request;
    await expect(port.resolvePermission({principal,permission:'audit.read',request})).resolves.toBe(true);
    await expect(port.resolvePermission({principal,permission:'unknown.permission',request})).resolves.toBe(false);
    for(const role of ['platform_operator','support_operator','billing_operator','read_only_operator'] as const)
      await expect(port.resolvePermission({principal:{...principal,roles:[role]},permission:'operator.overview.read',request})).resolves.toBe(false);
  });
});
