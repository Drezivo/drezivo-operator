import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import type { SafeOperatorPrincipal } from './operator-auth.js';
import { requireOperatorPermission, type OperatorPermission } from './operator-permission.js';

export const authorizationContractVersion = 'operator-authorization.v1' as const;
export const operatorRoleSchema = z.enum(['platform_owner', 'platform_operator', 'support_operator', 'billing_operator', 'read_only_operator']);
export type OperatorRole = z.infer<typeof operatorRoleSchema>;

export const rolePermissions: Readonly<Record<OperatorRole, readonly OperatorPermission[]>> = {
  platform_owner: ['operator.overview.read', 'business.summary.read', 'support.grant.create', 'support.grant.revoke', 'job.read', 'notification.read', 'job.retry', 'notification.retry'],
  platform_operator: ['operator.overview.read', 'business.summary.read', 'job.read', 'notification.read', 'job.retry', 'notification.retry'],
  support_operator: ['operator.overview.read', 'business.summary.read', 'support.grant.create', 'support.grant.revoke'],
  billing_operator: ['operator.overview.read', 'business.summary.read'],
  read_only_operator: ['operator.overview.read', 'business.summary.read'],
};

export type AuthorizationPort = {
  version: typeof authorizationContractVersion;
  resolveMembership(input: { clerkUserId: string; operatorOrganizationId: string; request: Request }): Promise<{ active: boolean; roles: OperatorRole[] }>;
  resolvePermission(input: { principal: SafeOperatorPrincipal; permission: OperatorPermission; request: Request }): Promise<boolean>;
  resolveTenantScope(input: { principal: SafeOperatorPrincipal; tenantId: string; request: Request }): Promise<boolean>;
};

export const denyAuthorizationPort: AuthorizationPort = {
  version: authorizationContractVersion,
  resolveMembership: async () => ({ active: false, roles: [] }),
  resolvePermission: async () => false,
  resolveTenantScope: async () => false,
};

export function createPermissionMiddleware(port: AuthorizationPort): (permission: string) => RequestHandler {
  return (permission) => requireOperatorPermission(permission as OperatorPermission, async ({ principal, permission: normalized, request }) => port.resolvePermission({ principal, permission: normalized, request }));
}
