import { clerkMiddleware, getAuth } from '@clerk/express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config, isClerkConfigured } from './config.js';
import { AppError } from './errors.js';
import { operatorRoleSchema, type OperatorRole } from './operator-authorization.js';

export type SafeOperatorPrincipal = {
  clerkUserId: string;
  operatorOrganizationId: string;
  roles: OperatorRole[];
  requestId: string;
};

export type OperatorMembershipResolver = (principal: {
  clerkUserId: string;
  operatorOrganizationId: string;
  request?: Request;
}) => Promise<{ active: boolean; roles: OperatorRole[] }>;

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
  request?: Request,
): Promise<SafeOperatorPrincipal> {
  if (!auth.isAuthenticated || !auth.userId || !auth.orgId) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  }
  if (auth.orgId !== expectedOrganizationId) {
    throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  }
  const membership = await membershipResolver({ clerkUserId: auth.userId, operatorOrganizationId: auth.orgId, request });
  const roles = operatorRoleSchema.array().length(1).safeParse(membership?.roles);
  if (membership?.active !== true || !roles.success) {
    throw new AppError(403, 'OPERATOR_ACCESS_REQUIRED', 'Operator access is required.');
  }
  return { clerkUserId: auth.userId, operatorOrganizationId: auth.orgId, roles: roles.data, requestId };
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
  const clerkHandler = clerkMiddleware();
  return createBearerOnlyClerkContext(clerkHandler);
}

/** Clerk may inspect cookies as well as bearer tokens; this API accepts bearer sessions only. */
export function createBearerOnlyClerkContext(clerkHandler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const cookieHeader = req.headers.cookie;
    delete req.headers.cookie;
    let resumed = false;
    const resume = (error?: unknown) => {
      if (resumed) return;
      resumed = true;
      if (cookieHeader !== undefined) req.headers.cookie = cookieHeader;
      next(error === undefined ? undefined : mapClerkProviderError(error));
    };
    try {
      clerkHandler(req, res, resume);
    } catch (error) {
      resume(error);
    }
  };
}

export function mapClerkProviderError(error: unknown): AppError {
  const details = asProviderError(error);
  const status = details.status;
  const code = details.code?.toLowerCase() ?? '';
  if (status === 401 || status === 403 || /auth|token|session|jwt|credential|unauthor/.test(code)) {
    return new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  }
  return new AppError(503, 'OPERATOR_AUTH_UNAVAILABLE', 'Operator authentication is temporarily unavailable.');
}

function asProviderError(error: unknown): { status?: number; code?: string } {
  if (!error || typeof error !== 'object') return {};
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };
  const status = typeof value.status === 'number' ? value.status : typeof value.statusCode === 'number' ? value.statusCode : undefined;
  const code = typeof value.code === 'string' ? value.code : typeof value.name === 'string' ? value.name : undefined;
  return { status, code };
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
        req,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function denyOperatorMembership(): Promise<{ active: false; roles: [] }> {
  return { active: false, roles: [] };
}
