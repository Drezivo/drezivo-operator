import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, iso, token, jobStatuses, notificationStatuses, jobSchema, notificationSchema, unavailableOperationsPort } from "./contracts.js";
import type { Job, Notification, OperationsFilters, OperationsPort } from "./contracts.js";
import { createOperationsService } from './service.js';

type Cursor = { v: 1; at: string | null; id: string; filter_hash: string };
const hash = (filters: OperationsFilters) => createHash('sha256').update('drezivo-operator-operations-cursor-v1').update(JSON.stringify(filters)).digest('hex');
export function encodeOperationsCursor(cursor: { availableAt: string; id: string } | { acceptedAt: string | null; deliveryId: string }, filters: OperationsFilters): string { const at = 'availableAt' in cursor ? cursor.availableAt : cursor.acceptedAt; const id = 'availableAt' in cursor ? cursor.id : cursor.deliveryId; return Buffer.from(JSON.stringify({ v: 1, at, id, filter_hash: hash(filters) } satisfies Cursor)).toString('base64url'); }
export function decodeCursor(value: string, filters: OperationsFilters, notifications = false): { availableAt: string; id: string } | { acceptedAt: string | null; deliveryId: string } { try { const p = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor; if (p.v !== 1 || p.filter_hash !== hash(filters) || !uuid.safeParse(p.id).success || (p.at !== null && (!iso.safeParse(p.at).success || (notifications && new Date(p.at).getTime() > Date.now())))) throw new Error(); return notifications ? { acceptedAt: p.at, deliveryId: p.id } : p.at === null ? (() => { throw new Error(); })() : { availableAt: p.at, id: p.id }; } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); } }
