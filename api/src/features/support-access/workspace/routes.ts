import { createWorkspaceController } from './controller.js';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { uuid, text, reason, fingerprint, key, scope, resourceParams, itemParams, workspaceOpenSchema, workspaceDeleteSchema, patches, workspaceListSchema, workspaceDetailSchema, workspacePreviewSchema, workspaceAccessSchema, unavailable } from "./contracts.js";
import type { WorkspacePort } from "./contracts.js";
function subject(res: Response): string {
  const principal = res.locals.operatorPrincipal;
  if (!principal || principal.roles.length !== 1 || principal.roles[0] !== 'platform_owner') throw new AppError(403, 'FORBIDDEN', 'Superadmin access is required.');
  return principal.clerkUserId as string;
}
export function createWorkspaceRouter(port: WorkspacePort = unavailable, authorize: RequestHandler, permission: (code: string) => RequestHandler) {
  const controller = createWorkspaceController(port, authorize, permission);
  const router = express.Router();
  router.use('/tenants/:tenantId/workspace', authorize, (_req, res, next) => { subject(res); next(); });
  router.post('/tenants/:tenantId/workspace', permission('workspace.access'), controller.openWorkspace);
  router.get('/tenants/:tenantId/workspace/:grantId', permission('workspace.read'), controller.getWorkspace);
  router.post('/tenants/:tenantId/workspace/:grantId/close', permission('workspace.access'), controller.closeWorkspace);
  router.get('/tenants/:tenantId/workspace/:grantId/records/:resource', permission('workspace.read'), controller.listRecords);
  router.get('/tenants/:tenantId/workspace/:grantId/records/:resource/:itemId', permission('workspace.read'), controller.getRecord);
  router.get('/tenants/:tenantId/workspace/:grantId/clothing/:itemId/delete-preview', permission('workspace.read'), controller.previewDeletion);
  router.post('/tenants/:tenantId/workspace/:grantId/records/:resource/:itemId/correct', permission('workspace.repair'), controller.correctRecord);
  router.post('/tenants/:tenantId/workspace/:grantId/clothing/:itemId/delete', permission('workspace.repair'), controller.deleteClothing);
  return router;
}
