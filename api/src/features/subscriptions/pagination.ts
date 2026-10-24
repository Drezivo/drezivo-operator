import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { AppError } from "../../shared/http/errors.js";
import { createHash } from "node:crypto";
import { uuid, isoDate, planCodeSchema, lifecycleStatusSchema, subscriptionSummarySchema, entitlementDetailSchema, unavailableBillingReadPort } from "./contracts.js";
import type { SubscriptionFilters, BillingReadPort } from "./contracts.js";
import { createBillingReadService } from './service.js';

type Cursor = { v: 1; current_period_end: string | null; tenant_id: string; filter_hash: string };
const cursorHash = (filters: SubscriptionFilters) => createHash('sha256').update('drezivo-operator-billing-cursor-v1').update(JSON.stringify(filters)).digest('hex');
export function encodeSubscriptionCursor(cursor: { currentPeriodEnd: string | null; tenantId: string }, filters: SubscriptionFilters): string {
  const payload: Cursor = { v: 1, current_period_end: cursor.currentPeriodEnd, tenant_id: cursor.tenantId, filter_hash: cursorHash(filters) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodeCursor(value: string, filters: SubscriptionFilters): { currentPeriodEnd: string | null; tenantId: string } {
  try {
    const p = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (p.v !== 1 || p.filter_hash !== cursorHash(filters) || (p.current_period_end !== null && !isoDate.safeParse(p.current_period_end).success) || !uuid.safeParse(p.tenant_id).success) throw new Error();
    return { currentPeriodEnd: p.current_period_end, tenantId: p.tenant_id };
  } catch { throw new AppError(400, 'VALIDATION_FAILED', 'The cursor is invalid.'); }
}
