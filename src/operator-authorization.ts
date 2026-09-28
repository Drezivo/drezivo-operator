import { createClerkClient } from '@clerk/express';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from './errors.js';
import { createClerkOperatorMembershipReader, type ClerkMembershipList, type ClerkOperatorRole } from './clerk-operator-membership.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';
import { requireOperatorPermission, type OperatorPermission } from './operator-permission.js';
import { config, isClerkConfigured } from './config.js';

export const authorizationContractVersion = 'operator-authorization.v1' as const;
export const operatorRoleSchema = z.enum(['platform_owner', 'platform_operator', 'support_operator', 'billing_operator', 'read_only_operator']);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const rolePermissions: Readonly<Record<OperatorRole, readonly OperatorPermission[]>> = {
  platform_owner: [
    'operator.overview.read', 'business.summary.read', 'audit.read', 'operator.directory.read', 'support.activity.read',
    'subscription.read', 'entitlement.read', 'platform.analytics.read', 'job.read', 'notification.read', 'support.grant.create', 'support.grant.revoke',
    'job.retry', 'notification.retry', 'tenant.admin.read', 'tenant.admin.manage',
  ],
  platform_operator: ['operator.overview.read', 'tenant.admin.read', 'tenant.admin.manage'],
  support_operator: ['operator.overview.read', 'tenant.admin.read'],
  billing_operator: ['operator.overview.read', 'subscription.read', 'platform.analytics.read'],
  read_only_operator: ['operator.overview.read'],
};

export type AuthorizationPort = {
  version: typeof authorizationContractVersion;
  resolveMembership(input: { clerkUserId: string; operatorOrganizationId: string; request?: Request }): Promise<{ active: boolean; roles: OperatorRole[] }>;
  resolvePermission(input: { principal: SafeOperatorPrincipal; permission: OperatorPermission; request: Request }): Promise<boolean>;
  resolveTenantScope(input: { principal: SafeOperatorPrincipal; tenantId: string; request: Request }): Promise<boolean>;
};

export const denyAuthorizationPort: AuthorizationPort = {
  version: authorizationContractVersion,
  resolveMembership: async () => ({ active: false, roles: [] }),
  resolvePermission: async () => false,
  resolveTenantScope: async () => false,
};

const clerkRoleToOperatorRole = {
  'org:platform_owner': 'platform_owner',
  'org:platform_operator': 'platform_operator',
  'org:support_operator': 'support_operator',
  'org:billing_operator': 'billing_operator',
  'org:read_only_operator': 'read_only_operator',
} as const satisfies Record<ClerkOperatorRole, OperatorRole>;

/** Builds role and permission decisions from the dedicated Clerk operator organization. */
export function createClerkAuthorizationPort(input: {
  organizationId: string;
  listMemberships: ClerkMembershipList;
}): AuthorizationPort {
  const readMembership = createClerkOperatorMembershipReader({ ...input, timeoutMs: 2_000 });
  return {
    version: authorizationContractVersion,
    resolveMembership: async ({ clerkUserId, operatorOrganizationId }) => {
      if (operatorOrganizationId !== input.organizationId) return { active: false, roles: [] };
      const membership = await readMembership(clerkUserId);
      if ('reason' in membership && membership.reason === 'provider_unavailable') {
        throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator authentication is temporarily unavailable.');
      }
      if (membership.active !== true) return { active: false, roles: [] };
      const role = clerkRoleToOperatorRole[membership.roles[0]];
      return role ? { active: true, roles: [role] } : { active: false, roles: [] };
    },
    resolvePermission: async ({ principal, permission }) => {
      const role = operatorRoleSchema.safeParse(principal.roles.length === 1 ? principal.roles[0] : undefined);
      if (!role.success || !rolePermissions[role.data].includes(permission)) return false;
      return role.data === 'platform_owner' || permission === 'operator.overview.read' ||
        (role.data === 'billing_operator' && (permission === 'subscription.read' || permission === 'platform.analytics.read')) ||
        (role.data === 'platform_operator' && (permission === 'tenant.admin.read' || permission === 'tenant.admin.manage')) ||
        (role.data === 'support_operator' && permission === 'tenant.admin.read');
    },
    resolveTenantScope: async ({ principal }) => principal.roles.length === 1 && principal.roles[0] === 'platform_owner',
  };
}

/** Uses only configured server keys and fails closed when the operator instance is incomplete. */
export function createConfiguredAuthorizationPort(): AuthorizationPort {
  const secretKey = config.CLERK_SECRET_KEY;
  const organizationId = config.OPERATOR_CLERK_ORGANIZATION_ID;
  if (!isClerkConfigured() || !secretKey || !organizationId) return denyAuthorizationPort;
  const clerk = createClerkClient({ secretKey });
  return createClerkAuthorizationPort({
    organizationId,
    listMemberships: ({ organizationId, userId, limit }) => clerk.organizations.getOrganizationMembershipList({
      organizationId,
      userId,
      limit,
    }),
  });
}

export function createPermissionMiddleware(port: AuthorizationPort): (permission: string) => RequestHandler {
  return (permission) => requireOperatorPermission(permission as OperatorPermission, async ({ principal, permission: normalized, request }) => port.resolvePermission({ principal, permission: normalized, request }));
}
