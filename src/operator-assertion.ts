import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';
import { operatorRoleSchema } from './operator-authorization.js';

export const operatorOverviewAssertionClaims = {
  issuer: 'drezivo-operator-api',
  audience: 'drezivo-business-api',
  permission: 'operator.overview.read',
  method: 'GET',
  path: '/internal/operator/v1/overview',
} as const;

export function createOperatorOverviewAssertion(input: {
  secret: string | undefined;
  principal: SafeOperatorPrincipal;
  requestId: string;
  now?: number;
}): string {
  const { secret, principal, requestId } = input;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw authUnavailable();
  const role = operatorRoleSchema.safeParse(principal?.roles?.length === 1 ? principal.roles[0] : undefined);
  if (!role.success || !principal.clerkUserId || !principal.operatorOrganizationId || !requestId || principal.requestId !== requestId) throw authUnavailable();

  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: operatorOverviewAssertionClaims.issuer,
    aud: operatorOverviewAssertionClaims.audience,
    sub: principal.clerkUserId,
    org_id: principal.operatorOrganizationId,
    role: role.data,
    permission: operatorOverviewAssertionClaims.permission,
    method: operatorOverviewAssertionClaims.method,
    path: operatorOverviewAssertionClaims.path,
    request_id: requestId,
    iat,
    exp: iat + 60,
    jti: randomUUID(),
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', Buffer.from(secret, 'utf8')).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function authUnavailable(): AppError {
  return new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.');
}
