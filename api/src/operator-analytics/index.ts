import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import { z } from 'zod';
import { AppError } from '../errors.js';
import type { SafeOperatorPrincipal } from '../operator-auth.js';

const count = z.number().int().nonnegative().safe();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const seriesPoint = z.object({ month, count }).strict();
function nextMonth(value: string): string {
  const year = Number(value.slice(0, 4));
  const monthNumber = Number(value.slice(5, 7));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}
function nextWeek(value: string): string {
  const year = Number(value.slice(0, 4));
  const weekNumber = Number(value.slice(6, 8));
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = januaryFourth.getUTCDay() || 7;
  const monday = Date.UTC(year, 0, 4 - weekday + 1 + (weekNumber - 1) * 7);
  const thursday = new Date(monday + 10 * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const weekOfYear = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(weekOfYear).padStart(2, '0')}`;
}
function isIsoWeek(value: string): boolean {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = januaryFourth.getUTCDay() || 7;
  const monday = Date.UTC(year, 0, 4 - weekday + 1 + (weekNumber - 1) * 7);
  const thursday = new Date(monday + 3 * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const weekOfYear = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return value === `${weekYear}-W${String(weekOfYear).padStart(2, '0')}`;
}
const week = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/).refine(isIsoWeek);
const weeklyPoint = z.object({ week, count }).strict();
function monthAtManilaBoundary(value: string): string | null {
  const instant = Date.parse(value);
  const local = new Date(instant + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(instant) || local.getUTCDate() !== 1 || local.getUTCHours() !== 0 || local.getUTCMinutes() !== 0 || local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0) return null;
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}
function weekAtManilaBoundary(value: string): string | null {
  const instant = Date.parse(value);
  const monday = new Date(instant + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(instant) || monday.getUTCDay() !== 1 || monday.getUTCHours() !== 0 || monday.getUTCMinutes() !== 0 || monday.getUTCSeconds() !== 0 || monday.getUTCMilliseconds() !== 0) return null;
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const weekYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const weekOfYear = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(weekOfYear).padStart(2, '0')}`;
}
function monthWindow(from: string, to: string, months: number): string[] | null {
  const first = monthAtManilaBoundary(from);
  const last = monthAtManilaBoundary(to);
  if (!first || !last) return null;
  const [year, monthNumber] = first.split('-').map(Number);
  const toDate = new Date(Date.UTC(year!, monthNumber! - 1 + months, 1));
  if (Date.parse(to) !== toDate.getTime() - 8 * 60 * 60 * 1000) return null;
  const expected = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year!, monthNumber! - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
  const targetMonth = `${toDate.getUTCFullYear()}-${String(toDate.getUTCMonth() + 1).padStart(2, '0')}`;
  if (last !== targetMonth) return null;
  return expected;
}
function weeklyWindow(from: string, to: string, weeks: number): string[] | null {
  if (weeks !== 52 || Date.parse(to) - Date.parse(from) !== 52 * 7 * 86_400_000) return null;
  const first = weekAtManilaBoundary(from);
  const last = weekAtManilaBoundary(to);
  if (!first || !last) return null;
  const values = [first];
  while (values.length < weeks) values.push(nextWeek(values.at(-1)!));
  if (nextWeek(values.at(-1)!) !== last) return null;
  return values;
}
function addProjectionIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: 'custom', path, message });
}
function validateMonthlySeries(
  value: z.infer<typeof analyticsSeries>,
  window: string[] | null,
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (!window) return;
  for (const key of ['new_businesses', 'memberships'] as const) {
    if (value[key].length !== window.length || value[key].some((point, index) => point.month !== window[index])) {
      addProjectionIssue(context, [...path, key], 'Monthly series must cover the complete selected window in order.');
    }
  }
  const allowed = new Set(window);
  const seen = new Set<string>();
  for (const [index, item] of value.subscription_events.entries()) {
    const key = `${item.month}:${item.event_type}`;
    if (!allowed.has(item.month) || seen.has(key)) addProjectionIssue(context, [...path, 'subscription_events', index], 'Monthly events must be unique and within the selected window.');
    seen.add(key);
  }
}
function validateWeeklySeries(
  value: z.infer<typeof weeklySeries>,
  window: string[] | null,
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (!window) return;
  for (const key of ['new_businesses', 'memberships'] as const) {
    if (value[key].length !== window.length || value[key].some((point, index) => point.week !== window[index])) {
      addProjectionIssue(context, [...path, key], 'Weekly series must cover the complete selected window in order.');
    }
  }
  const allowed = new Set(window);
  const seen = new Set<string>();
  for (const [index, item] of value.subscription_events.entries()) {
    const key = `${item.week}:${item.event_type}`;
    if (!allowed.has(item.week) || seen.has(key)) addProjectionIssue(context, [...path, 'subscription_events', index], 'Weekly events must be unique and within the selected window.');
    seen.add(key);
  }
}
const runRate = z.array(z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: z.string().regex(/^(0|[1-9]\d*)$/),
  active_subscription_count: count,
}).strict()).max(100);
const forecast = z.object({
  horizon_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  points: z.array(seriesPoint).min(1).max(12).optional(),
  withheld_reason: z.enum(['insufficient_history', 'baseline_not_beaten']).optional(),
}).strict().superRefine((value, context) => {
  const hasPoints = value.points !== undefined;
  const hasReason = value.withheld_reason !== undefined;
  if (hasPoints === hasReason) {
    context.addIssue({ code: 'custom', message: 'A forecast must have points or one withheld reason.' });
    return;
  }
  if (!value.points) return;
  if (value.points.length !== value.horizon_months) {
    context.addIssue({ code: 'custom', message: 'Forecast point count must match its horizon.' });
  }
  for (let index = 1; index < value.points.length; index += 1) {
    const current = value.points[index];
    const previous = value.points[index - 1];
    if (!current || !previous || current.month !== nextMonth(previous.month)) {
      context.addIssue({ code: 'custom', message: 'Forecast points must be consecutive months.' });
      break;
    }
  }
});
const forecastSet = z.array(forecast).length(4).superRefine((forecasts, context) => {
  const expectedHorizons = [1, 3, 6, 12];
  if (forecasts.some((item, index) => item.horizon_months !== expectedHorizons[index])) {
    context.addIssue({ code: 'custom', message: 'Forecasts must cover horizons 1, 3, 6, and 12 months once each.' });
  }
});
const analyticsSeries = z.object({
  new_businesses: z.array(seriesPoint).max(48),
  memberships: z.array(seriesPoint).max(48),
  subscription_events: z.array(z.object({
    month,
    event_type: z.enum(['trial_started', 'past_due', 'restricted', 'plan_changed']),
    count,
  }).strict()).max(192),
}).strict();
const weeklyCounts = z.array(weeklyPoint).length(52).superRefine((points, context) => {
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    if (!current || !previous || current.week !== nextWeek(previous.week)) {
      context.addIssue({ code: 'custom', message: 'Weekly points must be consecutive ISO weeks.' });
      break;
    }
  }
});
const weeklySeries = z.object({
  new_businesses: weeklyCounts,
  memberships: weeklyCounts,
  subscription_events: z.array(z.object({
    week,
    event_type: z.enum(['trial_started', 'past_due', 'restricted', 'plan_changed']),
    count,
  }).strict()).max(208),
}).strict();
const lifecycleCounts = z.object({ active: count, trialing: count, past_due: count, restricted: count, cancelled: count }).strict();

/** Mirrors @drezivo/contracts operatorAnalyticsQuery until the peer package is consumable here. */
export const operatorAnalyticsQuery = z.object({
  months: z.union([z.literal('12'), z.literal('24'), z.literal('36'), z.literal('48')]).transform(Number).default(48),
}).strict();

/** Mirrors @drezivo/contracts operatorAnalyticsResponse; upstream and route DTOs use this strict shape. */
export const operatorAnalyticsResponse = z.object({
  as_of: z.string().datetime({ offset: true }),
  timezone: z.literal('Asia/Manila'),
  period: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    months: z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]),
  }).strict().refine(({ from, to }) => Date.parse(from) < Date.parse(to)),
  weekly_period: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    weeks: z.literal(52),
  }).strict().refine(({ from, to }) => Date.parse(from) < Date.parse(to)),
  businesses: z.object({ total: count }).strict(),
  subscriptions: lifecycleCounts,
  members: z.object({ provisioned: count }).strict(),
  active_plan_monthly_list_price_run_rate: runRate,
  series: analyticsSeries,
  weekly_series: weeklySeries,
  forecasts: z.object({
    new_businesses: forecastSet,
    memberships: forecastSet,
    active_subscribers: z.object({ withheld_reason: z.literal('incomplete_history') }).strict(),
    monthly_list_price_run_rate: z.object({ withheld_reason: z.literal('incomplete_history') }).strict(),
  }).strict(),
  synthetic: z.object({
    businesses: z.object({ total: count }).strict(),
    subscriptions: lifecycleCounts,
    members: z.object({ provisioned: count }).strict(),
    series: analyticsSeries,
    weekly_series: weeklySeries,
    active_plan_monthly_list_price_run_rate: runRate,
  }).strict(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.period.from) >= Date.parse(value.period.to)) {
    addProjectionIssue(context, ['period'], 'The monthly period must have positive duration.');
  }
  if (Date.parse(value.weekly_period.from) >= Date.parse(value.weekly_period.to)) {
    addProjectionIssue(context, ['weekly_period'], 'The weekly period must have positive duration.');
  }
  const monthly = monthWindow(value.period.from, value.period.to, value.period.months);
  if (!monthly) addProjectionIssue(context, ['period'], 'The monthly period must use complete Asia/Manila calendar-month boundaries.');
  const forecastStart = monthAtManilaBoundary(value.period.to);
  for (const [metric, forecasts] of [
    ['new_businesses', value.forecasts.new_businesses],
    ['memberships', value.forecasts.memberships],
  ] as const) {
    for (const [index, forecast] of forecasts.entries()) {
      if (forecast.points && forecast.points[0]?.month !== forecastStart) {
        addProjectionIssue(context, ['forecasts', metric, index, 'points', 0, 'month'], 'The first forecast point must start in the Manila month at the selected period end.');
      }
    }
  }
  const weekly = weeklyWindow(value.weekly_period.from, value.weekly_period.to, value.weekly_period.weeks);
  if (!weekly) addProjectionIssue(context, ['weekly_period'], 'The weekly period must cover 52 complete Asia/Manila ISO weeks.');
  validateMonthlySeries(value.series, monthly, context, ['series']);
  validateWeeklySeries(value.weekly_series, weekly, context, ['weekly_series']);
  validateMonthlySeries(value.synthetic.series, monthly, context, ['synthetic', 'series']);
  validateWeeklySeries(value.synthetic.weekly_series, weekly, context, ['synthetic', 'weekly_series']);
});
export type OperatorAnalyticsQuery = z.infer<typeof operatorAnalyticsQuery>;
export type OperatorAnalyticsResponse = z.infer<typeof operatorAnalyticsResponse>;

export type AnalyticsReadPort = {
  getAnalytics(input: { principal: SafeOperatorPrincipal; months: OperatorAnalyticsQuery['months']; requestId: string }): Promise<OperatorAnalyticsResponse>;
};

export const unavailableAnalyticsReadPort: AnalyticsReadPort = {
  getAnalytics: async () => { throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.'); },
};

export type AnalyticsRouterOptions = { permissionMiddleware?: (permission: string) => RequestHandler };
const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.');
const envelope = (data: OperatorAnalyticsResponse, requestId: string) => ({ success: true, data, request_id: requestId });

function parseQuery(req: Request): OperatorAnalyticsQuery {
  const query = req.query as Record<string, unknown>;
  const parsed = operatorAnalyticsQuery.safeParse(query);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_FAILED', 'The analytics query is invalid.');
  return parsed.data;
}

function sendError(next: NextFunction, error: unknown): void {
  next(error instanceof AppError ? error : new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The analytics read service is unavailable.', { cause: error }));
}

export function createOperatorAnalyticsRouter(
  readPort: AnalyticsReadPort = unavailableAnalyticsReadPort,
  authorize: RequestHandler = (_req, _res, next) => next(),
  options: AnalyticsRouterOptions = {},
): Router {
  const router = express.Router();
  const permission = options.permissionMiddleware ?? (() => (_req: Request, _res: Response, next: NextFunction) => next(forbidden()));
  router.use(authorize);
  router.get('/analytics', permission('platform.analytics.read'), async (req, res, next) => {
    try {
      const query = parseQuery(req);
      const principal = res.locals.operatorPrincipal as SafeOperatorPrincipal | undefined;
      if (!principal) throw forbidden();
      const requestId = String(res.locals.requestId ?? 'unknown');
      const parsed = operatorAnalyticsResponse.safeParse(await readPort.getAnalytics({ principal, months: query.months, requestId }));
      if (!parsed.success) throw new AppError(503, 'DEPENDENCY_INVALID_RESPONSE', 'The analytics read service returned an invalid response.');
      res.setHeader('Cache-Control', 'no-store');
      res.json(envelope(parsed.data, requestId));
    } catch (error) { sendError(next, error); }
  });
  return router;
}
