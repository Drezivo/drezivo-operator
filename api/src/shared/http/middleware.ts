import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError, errorBody } from './errors.js';
import { clerkContextMiddleware, requireOperator } from '../auth/operator-auth.js';
import { logger } from '../logging/logger.js';
import { safeDiagnosticFields, safeErrorSummary } from '../logging/failure-diagnostics.js';

declare global {
  namespace Express {
    interface Locals { routePrefix?: string }
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Preserve the stable API mount prefix after Express unwinds a router error. */
export function recordRoutePrefix(prefix: string): RequestHandler {
  return (_req, res, next) => {
    res.locals.routePrefix = prefix;
    next();
  };
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  if (supplied !== undefined && !REQUEST_ID_PATTERN.test(supplied)) {
    next(new AppError(400, 'INVALID_REQUEST_ID', 'The request ID is invalid.'));
    return;
  }
  const id = supplied || randomUUID();
  res.setHeader('x-request-id', id);
  res.locals.requestId = id;
  next();
}

export { clerkContextMiddleware, requireOperator };

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const requestIdValue = String(res.locals.requestId || 'unknown');
  const route = normalizedRoute(req, res);
  const diagnostics = error instanceof AppError ? error.diagnostics ?? inferDiagnostics(error, route) : undefined;
  const shouldLog = error instanceof AppError
    ? error.status >= 500 || diagnostics?.reason === 'permission_denied'
    : !isBodyParseError(error);
  if (shouldLog) logServerFailure({ requestId: requestIdValue, method: req.method, route, error, diagnostics });
  if (error instanceof AppError) { res.status(error.status).json(errorBody(error.code, error.message, requestIdValue)); return; }
  if (isBodyParseError(error)) {
    const status = error.type === 'entity.too.large' ? 413 : 400;
    const code = error.type === 'entity.too.large' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON';
    const message = error.type === 'entity.too.large' ? 'The request body is too large.' : 'The request body is invalid JSON.';
    res.status(status).json(errorBody(code, message, requestIdValue));
    return;
  }
  res.status(500).json(errorBody('INTERNAL_ERROR', 'The request could not be completed.', requestIdValue));
}

/** Provider messages can contain SQL literals, URLs and personal data. Log codes, never raw text. */
function logServerFailure(input: {
  requestId: string;
  method: string;
  route: string;
  error: unknown;
  diagnostics?: AppError['diagnostics'];
}): void {
  const { error } = input;
  const cause = error instanceof Error ? error.cause : undefined;
  logger.error({
    event: 'api.request.failed',
    request_id: input.requestId,
    method: input.method,
    route: input.route,
    status: error instanceof AppError ? error.status : 500,
    ...(error instanceof AppError ? { code: error.code } : {}),
    ...safeDiagnosticFields(input.diagnostics),
    error: safeErrorSummary(error),
    ...(cause !== undefined ? { cause: safeErrorSummary(cause) } : {}),
  }, 'API request failed');
}

/** The route template is safe to log; originalUrl may contain IDs, search terms, or tokens. */
function normalizedRoute(req: Request, res: Response): string {
  const base = req.baseUrl.replace(/\/$/, '');
  const path = typeof req.route?.path === 'string' ? req.route.path : undefined;
  if (path) {
    if (path === '/health' || path === '/ready' || path.startsWith('/operator/') || path.startsWith('/webhooks/')) return path;
    const prefix = base || String(res.locals.routePrefix ?? '');
    return `${prefix}${path}` || '/';
  }
  const prefix = base || String(res.locals.routePrefix ?? '');
  if (prefix === '/api/v1' || prefix === '/operator') return `${prefix}/*`;
  return 'unmatched';
}

function inferDiagnostics(error: AppError, route: string): AppError['diagnostics'] {
  const missing = (key: string) => !process.env[key]?.trim();
  const missingKeys = (keys: readonly string[]) => keys.filter(missing);
  if (error.code === 'OPERATOR_AUTH_NOT_CONFIGURED') {
    return {
      dependency: 'operator_auth', reason: 'not_configured',
      configurationKeys: missingKeys(['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'OPERATOR_CLERK_ORGANIZATION_ID']),
    };
  }
  if (error.code === 'OPERATOR_AUTH_UNAVAILABLE') {
    return { dependency: 'operator_auth', reason: 'provider_unavailable' };
  }
  if (error.status < 500) return undefined;

  const reason = error.code === 'DEPENDENCY_INVALID_RESPONSE' ? 'invalid_response' : 'dependency_unavailable';
  if (route === '/webhooks/operator-clerk') {
    const keys = [
      ...(missing('OPERATOR_TENANT_ADMIN_DATABASE_URL') ? ['OPERATOR_TENANT_ADMIN_DATABASE_URL'] : []),
      ...(missing('OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET') ? ['OPERATOR_CLERK_WEBHOOK_SIGNING_SECRET'] : []),
    ];
    return { dependency: 'session_audit', reason: keys.length ? 'not_configured' : reason, configurationKeys: keys };
  }
  if (route.endsWith('/proof-link')) {
    if (missing('OPERATOR_TENANT_ADMIN_DATABASE_URL')) {
      return { dependency: 'tenant_admin_database', reason: 'not_configured', configurationKeys: ['OPERATOR_TENANT_ADMIN_DATABASE_URL'] };
    }
    const keys = missingKeys(['OPERATOR_PROOF_LINK_SECRET', 'BUSINESS_API_PUBLIC_URL']);
    return { dependency: 'proof_link', reason: keys.length ? 'not_configured' : reason, configurationKeys: keys };
  }
  if (route === '/api/v1/operators') {
    const clerkKeys = missingKeys(['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'OPERATOR_CLERK_ORGANIZATION_ID']);
    const internalKeys = missingKeys(['INTERNAL_SERVICE_BASE_URL', 'INTERNAL_SERVICE_AUTH']);
    if (clerkKeys.length === 0) return { dependency: 'operator_auth', reason };
    return {
      dependency: 'internal_service',
      reason: clerkKeys.length > 0 && internalKeys.length > 0 ? 'not_configured' : reason,
      configurationKeys: clerkKeys.length > 0 && internalKeys.length > 0 ? [...clerkKeys, ...internalKeys] : [],
    };
  }

  const databaseRoute = /^\/api\/v1\/(people|tenants(?:\/|$)|subscription-payments|platform-payment-methods|audit-events|session(?:\/events)?$)/.test(route);
  const consoleRoute = /^\/api\/v1\/(businesses|overview|subscriptions|analytics|jobs|notifications|operators)/.test(route);
  if (databaseRoute || (consoleRoute && !missing('OPERATOR_TENANT_ADMIN_DATABASE_URL'))) {
    const keys = missingKeys(['OPERATOR_TENANT_ADMIN_DATABASE_URL']);
    return { dependency: 'tenant_admin_database', reason: keys.length ? 'not_configured' : reason, configurationKeys: keys };
  }
  if (consoleRoute) {
    const keys = missingKeys(['INTERNAL_SERVICE_BASE_URL', 'INTERNAL_SERVICE_AUTH']);
    const assertionRequired = ['/api/v1/businesses', '/api/v1/overview', '/api/v1/subscriptions', '/api/v1/analytics'].some((prefix) => route.startsWith(prefix))
      || ((route.startsWith('/api/v1/jobs') || route.startsWith('/api/v1/notifications')) && !route.endsWith('/retry'));
    if (assertionRequired && missing('INTERNAL_OPERATOR_ASSERTION_SECRET')) {
      keys.push('INTERNAL_OPERATOR_ASSERTION_SECRET');
    }
    return { dependency: 'internal_service', reason: keys.length ? 'not_configured' : reason, configurationKeys: keys };
  }
  return undefined;
}

function isBodyParseError(error: unknown): error is { type: 'entity.too.large' | 'entity.parse.failed' } {
  if (!error || typeof error !== 'object') return false;
  const type = (error as { type?: unknown }).type;
  return type === 'entity.too.large' || type === 'entity.parse.failed';
}
