import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { SafeOperatorPrincipal } from './operator-auth.js';

/** Permission identifiers are configuration, so malformed values must never authorize a request. */
export const operatorPermissionSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/);
export type OperatorPermission = z.infer<typeof operatorPermissionSchema>;

export type OperatorPermissionResolver = (input: {
  principal: SafeOperatorPrincipal;
  permission: OperatorPermission;
  request: Request;
}) => boolean | Promise<boolean>;

const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
const unavailable = () => new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator authorization is temporarily unavailable.');

/**
 * Checks a verified operator principal without reading request data or performing side effects.
 * The default resolver denies access until a membership/permission source is injected.
 */
export function requireOperatorPermission(permission: OperatorPermission, resolver: OperatorPermissionResolver = async () => false): RequestHandler {
  const parsedPermission = operatorPermissionSchema.safeParse(permission);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!parsedPermission.success) { next(forbidden()); return; }
    const principal = res.locals.operatorPrincipal as SafeOperatorPrincipal | undefined;
    if (!principal) { next(forbidden()); return; }
    try {
      const allowed = await resolver({ principal, permission: parsedPermission.data, request: req });
      if (allowed !== true) { next(forbidden()); return; }
      next();
    } catch { next(unavailable()); }
  };
}
