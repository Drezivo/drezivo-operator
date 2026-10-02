import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';

export const tenantIdSchema = z.string().uuid();
export type TenantId = z.infer<typeof tenantIdSchema>;
export type TenantIdExtractor = (request: Request) => unknown;
export type TenantScopeResolver = (input: {
  principal: SafeOperatorPrincipal;
  tenantId: TenantId;
  request: Request;
}) => boolean | Promise<boolean>;

const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
const unavailable = () => new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator authorization is temporarily unavailable.');
const parameterName = z.string().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_]*$/);

/** Extracts a route parameter while rejecting unsafe parameter names at configuration time. */
export function tenantIdFromPath(paramName = 'tenantId'): TenantIdExtractor {
  if (!parameterName.safeParse(paramName).success) return () => undefined;
  return (request: Request) => request.params[paramName];
}

/** Ensures the verified operator is authorized for the tenant selected by the route. */
export function requireOperatorTenantScope(
  extractTenantId: TenantIdExtractor,
  resolver: TenantScopeResolver = async () => false,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const principal = res.locals.operatorPrincipal as SafeOperatorPrincipal | undefined;
    if (!principal) { next(forbidden()); return; }
    let tenantId: TenantId;
    try {
      const parsed = tenantIdSchema.safeParse(extractTenantId(req));
      if (!parsed.success) { next(forbidden()); return; }
      tenantId = parsed.data;
    } catch { next(forbidden()); return; }
    try {
      const allowed = await resolver({ principal, tenantId, request: req });
      if (allowed !== true) { next(forbidden()); return; }
      next();
    } catch { next(unavailable()); }
  };
}
