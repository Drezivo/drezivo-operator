import { z } from 'zod';
import { AppError } from '../../../../shared/http/errors.js';
import type { SafeOperatorPrincipal } from '../../../../shared/auth/operator-auth.js';
import { createOperatorPlanCommandAssertion, type PlanCommandBody } from '../../../../shared/auth/operator-plan-command-assertion.js';
import { createInternalServiceClient, type InternalServiceClient } from '../../../../infrastructure/http/internal-service-client.js';
import type { CommandContext, CommandResult, TenantAdminPort } from '../contracts.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type BusinessPlanCommandOptions = {
  baseUrl: string;
  serviceAuth: (requestId: string) => string | Promise<string>;
  operatorAssertionSecret?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  allowInsecureTransport?: boolean;
};

const successEnvelope = z.object({
  success: z.literal(true),
  request_id: z.string().min(1).max(128),
  data: z.object({
    tenant_id: z.string().uuid(),
    plan_code: z.enum(['starter', 'standard', 'growth', 'scale']),
    changed: z.boolean(),
    replayed: z.boolean(),
  }).strict(),
}).strict();
const failureEnvelope = z.object({
  success: z.literal(false),
  request_id: z.string().min(1).max(128),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).passthrough(),
}).passthrough();

export function createBusinessPlanCommandAdapter(options: BusinessPlanCommandOptions, reads: Pick<TenantAdminPort, 'getTenant'>): Pick<TenantAdminPort, 'changeSubscriptionPlan'> {
  const client: InternalServiceClient = createInternalServiceClient({
    baseUrl: options.baseUrl,
    serviceAuth: options.serviceAuth,
    timeoutMs: options.timeoutMs,
    allowInsecureTransport: options.allowInsecureTransport,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl as typeof fetch } : {}),
  });

  return {
    async changeSubscriptionPlan(tenantId, planCode, context): Promise<CommandResult> {
      if (!options.operatorAssertionSecret || !context.operatorOrganizationId || !context.operatorRole) {
        throw new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator plan changes are not configured.');
      }
      const body: PlanCommandBody = { plan_code: planCode, ...(context.reason ? { reason: context.reason } : {}) };
      const path = `/internal/operator/v1/tenants/${encodeURIComponent(tenantId)}/plan`;
      const principal: SafeOperatorPrincipal = {
        clerkUserId: context.operatorSubject,
        operatorOrganizationId: context.operatorOrganizationId,
        roles: [context.operatorRole as SafeOperatorPrincipal['roles'][number]],
        requestId: context.requestId,
      };
      const assertion = createOperatorPlanCommandAssertion({
        secret: options.operatorAssertionSecret,
        principal,
        requestId: context.requestId,
        tenantId,
        path,
        idempotencyKey: context.idempotencyKey,
        body,
      });
      const response = await client.requestJsonResponse<unknown>(path, {
        requestId: context.requestId,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': context.idempotencyKey },
        operatorAssertion: assertion,
      }, [200, 401, 403, 404, 409, 422]);

      if (response.status !== 200) {
        const failure = failureEnvelope.safeParse(response.data);
        if (!failure.success || failure.data.request_id !== context.requestId) {
          throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business service returned an invalid response.');
        }
        throw new AppError(response.status, failure.data.error.code as never, failure.data.error.message);
      }

      const result = successEnvelope.safeParse(response.data);
      if (!result.success || result.data.request_id !== context.requestId || result.data.data.tenant_id !== tenantId) {
        throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business service returned an invalid response.');
      }
      const tenant = await reads.getTenant(tenantId);
      if (!tenant) throw new AppError(404, 'NOT_FOUND', 'The business was not found.');
      if (tenant.subscription?.plan_code !== result.data.data.plan_code) {
        throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The business service returned stale plan details.');
      }
      return { tenant, changed: result.data.data.changed, replayed: result.data.data.replayed };
    },
  };
}
