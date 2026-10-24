import { createOperatorAuditController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, actorKinds, platformBillingActions, outcomes, token, opaqueKey, auditEventSchema, unavailableAuditPort } from "./contracts.js";
import type { AuditFilters, AuditCursor, AuditPort } from "./contracts.js";
export { encodeAuditCursor } from './pagination.js';

export const auditPermission = 'audit.read';
type AuditRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler; actionCodes?: readonly string[]; entityTypes?: readonly string[] };
export function createOperatorAuditRouter(auditPort: AuditPort = unavailableAuditPort, authorize: RequestHandler = (_req, _res, next) => next(), options: AuditRouterOptions = {}): Router {
  const controller = createOperatorAuditController(auditPort, authorize, options);
  const router = express.Router();
  const permissionMiddleware = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/audit-events', permissionMiddleware(auditPermission), controller.listAuditEvents);
  return router;
}
