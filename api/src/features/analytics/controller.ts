import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import type { SafeOperatorPrincipal } from "../../shared/auth/operator-auth.js";
import { operatorAnalyticsQuery, operatorAnalyticsResponse, unavailableAnalyticsReadPort } from "./contracts.js";
import type { OperatorAnalyticsQuery, OperatorAnalyticsResponse, AnalyticsReadPort } from "./contracts.js";

export type AnalyticsRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
const envelope = (data: OperatorAnalyticsResponse, requestId: string) => ({ success: true, data, request_id: requestId });

function parseQuery(req: Request): OperatorAnalyticsQuery {
  const query = req.query as Record<string, unknown>;
  const parsed = operatorAnalyticsQuery.safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The analytics query is invalid.');
  return parsed.data;
}

function sendError(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.', { cause: error }));
}



import { createAnalyticsReadService } from './service.js';

export function createOperatorAnalyticsController(
  readPort: AnalyticsReadPort = unavailableAnalyticsReadPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: AnalyticsRouterOptions = {},
) {
  const service = createAnalyticsReadService(readPort);
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(forbidden()));
  return {
    showAnalytics: async (req, res, next) => {
    try {
      const query = parseQuery(req);
      const principal = res.locals.operatorPrincipal as SafeOperatorPrincipal | undefined;
      if (!principal) throw forbidden();
      const requestId = String(res.locals.requestId ?? 'unknown');
      const parsed = operatorAnalyticsResponse.safeParse(await service.getAnalytics({ principal, months: query.months, requestId }));
      if (!parsed.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(envelope(parsed.data, requestId));
    } catch (error) { sendError(next, error); }
  },
  } satisfies Record<string, RequestHandler>;
}
