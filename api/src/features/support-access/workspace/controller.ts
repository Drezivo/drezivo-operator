import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { uuid, text, reason, fingerprint, key, scope, resourceParams, itemParams, workspaceOpenSchema, workspaceDeleteSchema, patches, workspaceListSchema, workspaceDetailSchema, workspacePreviewSchema, workspaceAccessSchema, unavailable } from "./contracts.js";
import type { WorkspacePort } from "./contracts.js";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(400, 'VALIDATION_FAILED', 'The workspace request is invalid.');
  return result.data;
}
function subject(res: Response): string {
  const principal = res.locals.operatorPrincipal;
  if (!principal || principal.roles.length !== 1 || principal.roles[0] !== 'platform_owner') throw new AppError(403, 'FORBIDDEN', 'Superadmin access is required.');
  return principal.clerkUserId as string;
}


import { createWorkspaceService } from './service.js';

export function createWorkspaceController(port: WorkspacePort = unavailable, authorize: RequestHandler, permission: (code: string) => RequestHandler)  {
  const service = createWorkspaceService(port);
  return {
    openWorkspace: async (req, res) => {
    const { tenantId } = parse(z.object({ tenantId: uuid }), req.params);
    const input = parse(workspaceOpenSchema, req.body);
    const data = workspaceAccessSchema.parse(await service.execute({ operation: 'open', subject: subject(res), tenantId, idempotencyKey: parse(key, req.get('Idempotency-Key')), requestId: String(res.locals.requestId), input }));
    res.status(201).json({ success: true, data, request_id: res.locals.requestId });
  },
    getWorkspace: async (req, res) => {
    const params = parse(scope, req.params); parse(z.object({}).strict(), req.query);
    const data = workspaceAccessSchema.parse(await service.execute({ operation: 'status', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: {} }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    closeWorkspace: async (req, res) => {
    const params = parse(scope, req.params); parse(z.object({}).strict(), req.body);
    const data = z.object({ grant_id: uuid, closed: z.literal(true) }).strict().parse(await service.execute({ operation: 'close', subject: subject(res), ...params, idempotencyKey: parse(key, req.get('Idempotency-Key')), requestId: String(res.locals.requestId), input: {} }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    listRecords: async (req, res) => {
    const { resource, ...params } = parse(resourceParams, req.params);
    const query = parse(z.object({ after: uuid.optional(), q: text(120).optional() }).strict(), req.query);
    const data = workspaceListSchema.parse(await service.execute({ operation: 'list', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource, ...query } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    getRecord: async (req, res) => {
    const { resource, itemId, ...params } = parse(itemParams, req.params); parse(z.object({}).strict(), req.query);
    const data = workspaceDetailSchema.parse(await service.execute({ operation: 'detail', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource, id: itemId } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    previewDeletion: async (req, res) => {
    const { itemId, ...params } = parse(scope.extend({ itemId: uuid }), req.params); parse(z.object({}).strict(), req.query);
    const data = workspacePreviewSchema.parse(await service.execute({ operation: 'delete-preview', subject: subject(res), ...params, requestId: String(res.locals.requestId), input: { resource: 'clothing', id: itemId } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    correctRecord: async (req, res) => {
    const { resource, itemId, ...params } = parse(itemParams, req.params);
    const body = parse(z.object({ fingerprint, reason, changes: z.unknown() }).strict(), req.body);
    const patch = patches[resource as keyof typeof patches];
    if (!patch) throw new AppError(400, 'VALIDATION_FAILED', 'This record must be changed through its business workflow.');
    const parsedChanges = patch.safeParse(body.changes);
    if (!parsedChanges.success) throw new AppError(400, 'VALIDATION_FAILED', 'The correction is invalid.');
    const changes = parsedChanges.data;
    if (!Object.keys(changes).length) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a correction.');
    const data = z.object({ id: uuid, corrected: z.literal(true) }).strict().parse(await service.execute({ operation: 'correct', subject: subject(res), ...params, requestId: String(res.locals.requestId), idempotencyKey: parse(key, req.get('Idempotency-Key')), input: { resource, id: itemId, ...body, changes } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
    deleteClothing: async (req, res) => {
    const { itemId, ...params } = parse(scope.extend({ itemId: uuid }), req.params);
    const body = parse(workspaceDeleteSchema, req.body);
    if (body.confirm_id !== itemId) throw new AppError(400, 'VALIDATION_FAILED', 'The confirmed item must match the selected clothing.');
    const data = z.object({ id: uuid, deleted: z.literal(true), variants: z.number(), assets: z.number(), images: z.number() }).strict().parse(await service.execute({ operation: 'delete', subject: subject(res), ...params, requestId: String(res.locals.requestId), idempotencyKey: parse(key, req.get('Idempotency-Key')), input: { resource: 'clothing', id: itemId, ...body } }));
    res.json({ success: true, data, request_id: res.locals.requestId });
  },
  } satisfies Record<string, RequestHandler>;
}
