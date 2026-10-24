import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { statusSchema, isoDate, uuid, operatorOverviewSchema, businessSummarySchema, businessDetailSchema, unavailableReadPort } from "./contracts.js";
import type { BusinessListFilters, ReadPort } from "./contracts.js";
import { createReadService } from './service.js';

type CursorPayload = { v: 1; created_at: string; tenant_id: string; filter_hash: string };
const cursorSecret = 'drezivo-operator-read-cursor-v1';
function filterHash(filters: BusinessListFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({ q: filters.q ?? null, status: [...filters.status], plan_code: filters.plan_code ?? null, sort: filters.sort })).digest('hex');
}
export function encodeBusinessCursor(cursor: { createdAt: string; tenantId: string }, filters: BusinessListFilters): string {
  const payload: CursorPayload = { v: 1, created_at: cursor.createdAt, tenant_id: cursor.tenantId, filter_hash: filterHash(filters) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodeBusinessCursor(value: string, filters: BusinessListFilters): { createdAt: string; tenantId: string } {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.created_at).success || !uuid.safeParse(payload.tenant_id).success) throw new Error('invalid');
    return { createdAt: payload.created_at, tenantId: payload.tenant_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
