import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createOperatorAnalyticsRouter, operatorAnalyticsResponse, type AnalyticsReadPort, type OperatorAnalyticsResponse } from '../src/operator-analytics/index.js';
import { createPermissionMiddleware, denyAuthorizationPort } from '../src/operator-authorization.js';

const requestId = 'analytics-request-1';
const principal = { clerkUserId: 'operator_user', operatorOrganizationId: 'operator_org', roles: ['platform_owner' as const], requestId };
function monthlySeries(start: string, months: number) {
  const [year, monthNumber] = start.split('-').map(Number);
  const points = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year!, monthNumber! - 1 + index, 1));
    return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, count: index };
  });
  return { new_businesses: points, memberships: points, subscription_events: [{ month: points[points.length - 1]!.month, event_type: 'trial_started' as const, count: 1 }] };
}
const series = monthlySeries('2022-09', 48);
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
let currentWeek = '2025-W39';
const weeklyCounts = Array.from({ length: 52 }, (_, index) => {
  const point = { week: currentWeek, count: index + 1 };
  currentWeek = nextWeek(currentWeek);
  return point;
});
const weeklySeries = { new_businesses: weeklyCounts, memberships: weeklyCounts, subscription_events: [{ week: '2026-W01', event_type: 'trial_started' as const, count: 1 }] };
const runRate = [{ currency: 'PHP', amount_minor: '120000', active_subscription_count: 3 }];
const withheldForecasts = [1, 3, 6, 12].map((horizon_months) => ({ horizon_months: horizon_months as 1 | 3 | 6 | 12, withheld_reason: 'insufficient_history' as const }));
function forecastFrom(start: string, horizon_months: 1 | 3 | 6 | 12) {
  const [year, monthNumber] = start.split('-').map(Number);
  return {
    horizon_months,
    points: Array.from({ length: horizon_months }, (_point, index) => {
      const date = new Date(Date.UTC(year!, monthNumber! - 1 + index, 1));
      return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, count: 1 };
    }),
  };
}
const lifecycle = { active: 3, trialing: 1, past_due: 0, restricted: 0, cancelled: 0 };
const analytics: OperatorAnalyticsResponse = {
  as_of: '2026-09-26T00:00:00.000Z',
  timezone: 'Asia/Manila',
  period: { from: '2022-08-31T16:00:00.000Z', to: '2026-08-31T16:00:00.000Z', months: 48 },
  weekly_period: { from: '2025-09-21T16:00:00.000Z', to: '2026-09-20T16:00:00.000Z', weeks: 52 },
  businesses: { total: 4 }, subscriptions: lifecycle, members: { provisioned: 12 },
  active_plan_monthly_list_price_run_rate: runRate,
  series, weekly_series: weeklySeries,
  forecasts: { new_businesses: withheldForecasts, memberships: withheldForecasts, active_subscribers: { withheld_reason: 'incomplete_history' }, monthly_list_price_run_rate: { withheld_reason: 'incomplete_history' } },
  synthetic: { businesses: { total: 1 }, subscriptions: lifecycle, members: { provisioned: 2 }, series, weekly_series: weeklySeries, active_plan_monthly_list_price_run_rate: runRate },
};

function app(readPort: AnalyticsReadPort, permission = (_name: string) => (_req: Request, _res: Response, next: NextFunction) => next(), withPrincipal = true) {
  const server = express();
  server.use((_req, res, next) => { res.locals.requestId = requestId; if (withPrincipal) res.locals.operatorPrincipal = principal; next(); });
  server.use('/api/v1', createOperatorAnalyticsRouter(readPort, (_req, _res, next) => next(), { permissionMiddleware: permission }));
  server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const typed = error as { status?: number; code?: string; message?: string };
    res.status(typed.status ?? 500).json({ success: false, error: { code: typed.code, message: typed.message }, request_id: requestId });
  });
  return server;
}

function port(overrides: Partial<AnalyticsReadPort> = {}): AnalyticsReadPort {
  return { getAnalytics: async () => analytics, ...overrides };
}

describe('operator platform analytics route', () => {
  it('requires point forecasts to start in the Manila month at period.to', async () => {
    const valid = { ...analytics, forecasts: { ...analytics.forecasts, new_businesses: [forecastFrom('2026-09', 1), ...withheldForecasts.slice(1)] } };
    expect(operatorAnalyticsResponse.safeParse(valid).success).toBe(true);
    for (const firstMonth of ['2026-08', '2026-10']) {
      const outOfWindow = { ...analytics, forecasts: { ...analytics.forecasts, memberships: [forecastFrom(firstMonth, 1), ...withheldForecasts.slice(1)] } };
      expect(operatorAnalyticsResponse.safeParse(outOfWindow).success).toBe(false);
    }
  });

  it('returns the aggregate projection, no-store, and the exact permission', async () => {
    const seen: string[] = [];
    const readPort = port({ getAnalytics: async ({ months, requestId: seenRequestId }) => {
      expect(months).toBe(48);
      expect(seenRequestId).toBe(requestId);
      return analytics;
    } });
    const response = await request(app(readPort, (name) => { seen.push(name); return (_req, _res, next) => next(); })).get('/api/v1/analytics');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(analytics);
    expect(response.body.request_id).toBe(requestId);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(seen).toEqual(['platform.analytics.read']);
  });

  it('uses the validated month window and rejects client snapshot time or scope', async () => {
    const getAnalytics = vi.fn(async () => analytics);
    const server = app(port({ getAnalytics }));
    const months = await request(server).get('/api/v1/analytics?months=12');
    expect(months.status).toBe(200);
    expect(getAnalytics).toHaveBeenCalledWith({ principal, months: 12, requestId });
    for (const query of ['months=11', 'as_of=2026-01-01T00%3A00%3A00Z', 'tenant_id=550e8400-e29b-41d4-a716-446655440000', 'months=12&months=24']) {
      const denied = await request(server).get(`/api/v1/analytics?${query}`);
      expect(denied.status).toBe(400);
      expect(denied.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(getAnalytics).toHaveBeenCalledTimes(1);
  });

  it('fails closed for absent principal and denied permission', async () => {
    expect((await request(app(port(), undefined, false)).get('/api/v1/analytics')).status).toBe(403);
    const denied = app(port(), createPermissionMiddleware(denyAuthorizationPort));
    const response = await request(denied).get('/api/v1/analytics');
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('private');
  });

  it('rejects malformed projections and maps unexpected adapter errors to a safe correlated response', async () => {
    const malformed = { ...analytics, private_field: 'not allowed' } as typeof analytics;
    const badDto = await request(app(port({ getAnalytics: async () => malformed }))).get('/api/v1/analytics');
    expect(badDto.status).toBe(503);
    expect(badDto.body.error.code).toBe('DEPENDENCY_INVALID_RESPONSE');
    expect(badDto.body.request_id).toBe(requestId);
    const failed = await request(app(port({ getAnalytics: async () => { throw new Error('upstream private response'); } }))).get('/api/v1/analytics');
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(failed.body.request_id).toBe(requestId);
    expect(JSON.stringify(failed.body)).not.toContain('private');
  });
});
