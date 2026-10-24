import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { iso, opaque, operatorRoleSchema, operatorStatusSchema, operatorDirectoryItemSchema, unavailableOperatorDirectoryPort } from "./contracts.js";
import type { OperatorDirectoryItem, OperatorDirectoryFilters, OperatorDirectoryCursor, OperatorDirectoryPort } from "./contracts.js";
import { createOperatorDirectoryService } from './service.js';

type EncodedCursor = { v: 1; last_activity_at: string | null; operator_id: string; filter_hash: string };

const cursorHash = (filters: OperatorDirectoryFilters) => createHash('sha256').update('drezivo-operator-directory-cursor-v1').update(JSON.stringify({ role: filters.role ?? null, status: filters.status ?? null })).digest('hex');
export function encodeOperatorDirectoryCursor(cursor: OperatorDirectoryCursor, filters: OperatorDirectoryFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, last_activity_at: cursor.lastActivityAt, operator_id: cursor.operatorId, filter_hash: cursorHash(filters) } satisfies EncodedCursor), 'utf8').toString('base64url');
}
export function decodeCursor(value: string, filters: OperatorDirectoryFilters): OperatorDirectoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as EncodedCursor;
    if (parsed.v !== 1 || parsed.filter_hash !== cursorHash(filters) || !opaque.safeParse(parsed.operator_id).success || (parsed.last_activity_at !== null && !iso.safeParse(parsed.last_activity_at).success)) throw new Error('invalid');
    if (parsed.last_activity_at && new Date(parsed.last_activity_at).getTime() > Date.now()) throw new Error('future');
    return { lastActivityAt: parsed.last_activity_at, operatorId: parsed.operator_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
