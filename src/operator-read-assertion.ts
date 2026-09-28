import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';
import { operatorRoleSchema } from './operator-authorization.js';

export type OperatorReadPermission =
  | 'operator.business.list.read'
  | 'operator.business.detail.read'
  | 'operator.subscription.list.read'
  | 'operator.entitlements.read'
  | 'job.read'
  | 'notification.read'
  | 'platform.analytics.read';

export function createOperatorReadAssertion(input: {
  secret: string | undefined;
  principal: SafeOperatorPrincipal;
  requestId: string;
  permission: OperatorReadPermission;
  path: string;
  query?: string;
  tenantId?: string;
  now?: number;
}): string {
  const { secret, principal, requestId, permission, path, query, tenantId } = input;
  const role = operatorRoleSchema.safeParse(principal?.roles?.length === 1 ? principal.roles[0] : undefined);
  const exactRoute = permission === 'operator.business.list.read' ? path === '/internal/operator/v1/businesses'
    : permission === 'operator.subscription.list.read' ? path === '/internal/operator/v1/subscriptions'
      : permission === 'job.read' ? path === '/internal/operator/v1/jobs'
        : permission === 'notification.read' ? path === '/internal/operator/v1/notifications'
          : permission === 'operator.business.detail.read' ? tenantId !== undefined && path === `/internal/operator/v1/businesses/${tenantId}`
            : permission === 'operator.entitlements.read' ? tenantId !== undefined && path === `/internal/operator/v1/businesses/${tenantId}/entitlements`
              : path === '/internal/operator/v1/analytics' && role.success && ['platform_owner', 'billing_operator'].includes(role.data);
  const queryBoundPermission = permission === 'job.read' || permission === 'notification.read' || permission === 'platform.analytics.read';
  const analyticsQueryValid = permission !== 'platform.analytics.read' || /^months=(12|24|36|48)$/.test(query ?? '');
  if (
    typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 || !role.success ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(principal.clerkUserId) || !principal.operatorOrganizationId ||
    !requestId || principal.requestId !== requestId || !exactRoute ||
    (queryBoundPermission !== (typeof query === 'string')) ||
    (queryBoundPermission && query === '') ||
    !analyticsQueryValid ||
    (tenantId !== undefined && !zUuid(tenantId))
  ) throw authUnavailable();

  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const claims: Record<string, unknown> = {
    iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: principal.clerkUserId,
    org_id: principal.operatorOrganizationId, role: role.data, permission, method: 'GET', path,
    request_id: requestId, iat, exp: iat + 60, jti: randomUUID(),
  };
  if (query !== undefined) claims.query_hash = createHash('sha256').update(query, 'utf8').digest('hex');
  if (tenantId !== undefined) claims.tenant_id = tenantId;
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', Buffer.from(secret, 'utf8')).update(signingInput, 'ascii').digest('base64url');
  return `${signingInput}.${signature}`;
}

function encode(value: unknown): string { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function zUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function authUnavailable(): AppError { return new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.'); }
