import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../http/errors.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';
import { operatorRoleSchema, rolePermissions } from './operator-authorization.js';

export type PlanCommandBody = { plan_code: 'starter' | 'standard' | 'growth' | 'scale'; reason?: string };

export function operatorPlanCommandBodyHash(body: PlanCommandBody): string {
  return createHash('sha256')
    .update(JSON.stringify({ plan_code: body.plan_code, reason: body.reason ?? null }), 'utf8')
    .digest('hex');
}

export function createOperatorPlanCommandAssertion(input: {
  secret: string | undefined;
  principal: SafeOperatorPrincipal;
  requestId: string;
  tenantId: string;
  path: string;
  idempotencyKey: string;
  body: PlanCommandBody;
  now?: number;
}): string {
  const role = operatorRoleSchema.safeParse(input.principal.roles.length === 1 ? input.principal.roles[0] : undefined);
  const expectedPath = `/internal/operator/v1/tenants/${input.tenantId}/plan`;
  if (
    typeof input.secret !== 'string' || Buffer.byteLength(input.secret, 'utf8') < 32 ||
    !role.success || !rolePermissions[role.data].includes('tenant.admin.manage') ||
    !input.principal.operatorOrganizationId || input.principal.requestId !== input.requestId ||
    input.path !== expectedPath || !/^[0-9a-f-]{36}$/i.test(input.tenantId) ||
    !/^[A-Za-z0-9_.:-]{16,200}$/.test(input.idempotencyKey)
  ) {
    throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator assertion authentication is unavailable.');
  }

  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'drezivo-operator-api', aud: 'drezivo-business-api', sub: input.principal.clerkUserId,
    org_id: input.principal.operatorOrganizationId, role: role.data, permission: 'tenant.admin.manage',
    method: 'POST', path: input.path, tenant_id: input.tenantId, request_id: input.requestId,
    idempotency_key: input.idempotencyKey, body_hash: operatorPlanCommandBodyHash(input.body),
    iat, exp: iat + 60, jti: randomUUID(),
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac('sha256', Buffer.from(input.secret, 'utf8')).update(signingInput, 'ascii').digest('base64url');
  return `${signingInput}.${signature}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
