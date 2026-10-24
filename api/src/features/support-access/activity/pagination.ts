import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, actorKinds, outcomes, token, supportActivitySchema, unavailableSupportActivityPort } from "./contracts.js";
import type { SupportActivityFilters, SupportActivityCursor, SupportActivityPort } from "./contracts.js";
import { createSupportActivityService } from './service.js';

const cursorSecret = 'drezivo-operator-support-activity-cursor-v1';
type CursorPayload = { v: 1; occurred_at: string; event_id: string; filter_hash: string };
function filterHash(filters: SupportActivityFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({
    tenant_id: filters.tenant_id ?? null, support_grant_id: filters.support_grant_id ?? null,
    actor_kind: filters.actor_kind ?? null, action: filters.action ?? null,
    entity_type: filters.entity_type ?? null, outcome: filters.outcome ?? null,
    occurred_from: filters.occurred_from ?? null, occurred_to: filters.occurred_to ?? null,
  })).digest('hex');
}
export function encodeSupportActivityCursor(cursor: SupportActivityCursor, filters: SupportActivityFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, occurred_at: cursor.occurredAt, event_id: cursor.eventId, filter_hash: filterHash(filters) } satisfies CursorPayload), 'utf8').toString('base64url');
}
export function decodeCursor(value: string, filters: SupportActivityFilters): SupportActivityCursor {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.occurred_at).success || new Date(payload.occurred_at).getTime() > Date.now() || !uuid.safeParse(payload.event_id).success) throw new Error('invalid');
    return { occurredAt: payload.occurred_at, eventId: payload.event_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
