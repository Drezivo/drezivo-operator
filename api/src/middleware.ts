import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError, errorBody } from './errors.js';
import { clerkContextMiddleware, requireOperator } from './operator-auth.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
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
  if (error instanceof AppError ? error.status >= 500 : !isBodyParseError(error)) logServerFailure(requestIdValue, error);
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
function logServerFailure(requestIdValue: string, error: unknown): void {
  const safeCodes = new Set(['28P01','28000','42501','23505','23503','23514','42P01','42703','42883','08001','08006','53300','53400','57P01','57014','55P03','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
  const describe = (value: unknown) => {
    if (!(value instanceof Error)) return { name: 'UnknownError' };
    const code = (value as { code?: unknown }).code;
    const name = ['Error','TypeError','RangeError','SyntaxError','AggregateError'].includes(value.name) ? value.name : 'Error';
    return { name, ...(typeof code === 'string' && safeCodes.has(code) ? { code } : {}) };
  };
  // eslint-disable-next-line no-console -- the API's one log line; Render collects stderr.
  console.error(JSON.stringify({
    level: 'error',
    request_id: requestIdValue,
    ...(error instanceof AppError ? { status: error.status, code: error.code } : {}),
    error: describe(error),
    ...(error instanceof Error && error.cause !== undefined ? { cause: describe(error.cause) } : {}),
  }));
}

function isBodyParseError(error: unknown): error is { type: 'entity.too.large' | 'entity.parse.failed' } {
  if (!error || typeof error !== 'object') return false;
  const type = (error as { type?: unknown }).type;
  return type === 'entity.too.large' || type === 'entity.parse.failed';
}
