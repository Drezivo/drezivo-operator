import { createOperatorDirectoryController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { iso, opaque, operatorRoleSchema, operatorStatusSchema, operatorDirectoryItemSchema, unavailableOperatorDirectoryPort } from "./contracts.js";
import type { OperatorDirectoryItem, OperatorDirectoryFilters, OperatorDirectoryCursor, OperatorDirectoryPort } from "./contracts.js";

export { encodeOperatorDirectoryCursor } from './pagination.js';

export const operatorDirectoryPermission = 'operator.directory.read';
export type OperatorDirectoryRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };

export function createOperatorDirectoryRouter(port: OperatorDirectoryPort = unavailableOperatorDirectoryPort, authorize: RequestHandler = (_req, _res, next) => next(), options: OperatorDirectoryRouterOptions = {}): Router {
  const controller = createOperatorDirectoryController(port, authorize, options);
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.')));
  router.use(authorize);
  router.get('/operators', permission(operatorDirectoryPermission), controller.listOperators);
  return router;
}
