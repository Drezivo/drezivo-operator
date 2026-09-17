import { clerkMiddleware, getAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config, isClerkConfigured } from './config.js';
import { AppError } from './errors.js';

export type SafeOperatorPrincipal = {
  clerkUserId: string;
  operatorOrganizationId: string;
  requestId: string;
};

export type OperatorMembershipResolver = (principal: {
  clerkUserId: string;
  operatorOrganizationId: string;
}) => boolean | Promise<boolean>;

export type VerifiedClerkAuth = {
  isAuthenticated: boolean;
  userId: string | null;
  orgId: string | null;
};

export type ClerkContextOptions = {
  membershipResolver?: OperatorMembershipResolver;
};

export async function authorizeOperator(
  auth: VerifiedClerkAuth,
  expectedOrganizationId: string,
  requestId: string,
  membershipResolver: OperatorMembershipResolver = denyOperatorMembership,
): Promise<SafeOperatorPrincipal> {
  if (!auth.isAuthenticated || !auth.userId || !auth.orgId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  }
  if (auth.orgId !== expectedOrganizationId) {
    throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  }
  const allowed = await membershipResolver({ clerkUserId: auth.userId, operatorOrganizationId: auth.orgId });
  if (!allowed) {
    throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  }
  return { clerkUserId: auth.userId, operatorOrganizationId: auth.orgId, requestId };
}

declare global {
  namespace Express {
    interface Locals {
      operatorPrincipal?: SafeOperatorPrincipal;
    }
  }
}

/** Adds Clerk's verified request context when server configuration is present. */
export function clerkContextMiddleware(): RequestHandler {
  if (!isClerkConfigured()) {
    return (_req, _res, next) => next();
  }
  return clerkMiddleware({ secretKey: config.CLERK_SECRET_KEY });
}

/**
 * Requires a verified Clerk user in the dedicated operator organization.
 * Local authorization is deliberately a separate seam and denies by default.
 */
export function requireOperator(options: ClerkContextOptions = {}): RequestHandler {
  const resolveMembership = options.membershipResolver ?? denyOperatorMembership;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.header('authorization');
    if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      return;
    }
    if (!isClerkConfigured()) {
      next(new AppError(503, 'OPERATOR_AUTH_NOT_CONFIGURED', 'Operator authentication is not configured.'));
      return;
    }

    let auth;
    try {
      auth = getAuth(req);
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      return;
    }

    const requestId = String(res.locals.requestId || 'unknown');
    try {
      res.locals.operatorPrincipal = await authorizeOperator(
        { isAuthenticated: auth.isAuthenticated, userId: auth.userId, orgId: auth.orgId ?? null },
        config.OPERATOR_CLERK_ORGANIZATION_ID ?? '',
        requestId,
        resolveMembership,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

function denyOperatorMembership(): false {
  return false;
}
