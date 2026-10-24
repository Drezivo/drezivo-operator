import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, actorKinds, platformBillingActions, outcomes, token, opaqueKey, auditEventSchema, unavailableAuditPort } from "./contracts.js";
import type { AuditFilters, AuditCursor, AuditPort } from "./contracts.js";
import { createAuditService } from './service.js';

type CursorPayload = { v: 1; occurred_at: string; event_id: string; filter_hash: string };
const cursorSecret = 'drezivo-operator-audit-cursor-v1';
function filterHash(filters: AuditFilters): string {
  return createHash('sha256').update(cursorSecret).update(JSON.stringify({ tenant_id: filters.tenant_id ?? null, actor_key: filters.actor_key ?? null, actor_kind: filters.actor_kind ?? null, entity_type: filters.entity_type ?? null, action: filters.action ?? null, outcome: filters.outcome ?? null, occurred_from: filters.occurred_from ?? null, occurred_to: filters.occurred_to ?? null })).digest('hex');
}
export function encodeAuditCursor(cursor: AuditCursor, filters: AuditFilters): string {
  return Buffer.from(JSON.stringify({ v: 1, occurred_at: cursor.occurredAt, event_id: cursor.eventId, filter_hash: filterHash(filters) } satisfies CursorPayload), 'utf8').toString('base64url');
}
export function decodeAuditCursor(value: string, filters: AuditFilters): AuditCursor {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.filter_hash !== filterHash(filters) || !isoDate.safeParse(payload.occurred_at).success || new Date(payload.occurred_at).getTime() > Date.now() || !uuid.safeParse(payload.event_id).success) throw new Error('invalid');
    return { occurredAt: payload.occurred_at, eventId: payload.event_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
