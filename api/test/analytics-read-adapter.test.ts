import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAnalyticsReadAdapter } from '../src/integrations/analytics-read/index.js';
import type { SafeOperatorPrincipal } from '../src/operator-auth.js';

const requestId = 'analytics-request-1';
const secret = 'operator-analytics-assertion-secret-over-32-bytes';
const principal: SafeOperatorPrincipal = { clerkUserId: 'operator_user', operatorOrganizationId: 'operator_org', roles: ['billing_operator'], requestId };
function monthlySeries(start: string, months: number) {
  const [year, monthNumber] = start.split('-').map(Number);
  const points = Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year!, monthNumber! - 1 + index, 1));
    return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`, count: 0 };
  });
  return { new_businesses: points, memberships: points, subscription_events: [{ month: points[0]!.month, event_type: 'trial_started', count: 1 }] };
}
const series = monthlySeries('2025-09', 12);
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
function weeklyPoints(start: string) {
  let currentWeek = start;
  return Array.from({ length: 52 }, (_, index) => {
    const point = { week: currentWeek, count: index + 1 };
    currentWeek = nextWeek(currentWeek);
    return point;
  });
}
const weeklyCounts = weeklyPoints('2025-W39');
const weeklySeries = { new_businesses: weeklyCounts, memberships: weeklyCounts, subscription_events: [{ week: '2026-W01', event_type: 'trial_started', count: 1 }] };
const forecasts = [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: 'insufficient_history' }));
const lifecycle = { active: 2, trialing: 1, past_due: 0, restricted: 0, cancelled: 0 };
const analytics = {
  as_of: '2026-09-26T00:00:00.000Z', timezone: 'Asia/Manila',
  period: { from: '2025-08-31T16:00:00.000Z', to: '2026-08-31T16:00:00.000Z', months: 12 },
  weekly_period: { from: '2025-09-21T16:00:00.000Z', to: '2026-09-20T16:00:00.000Z', weeks: 52 },
  businesses: { total: 3 }, subscriptions: lifecycle, members: { provisioned: 7 }, active_plan_monthly_list_price_run_rate: [],
  series, weekly_series: weeklySeries,
  forecasts: { new_businesses: forecasts, memberships: forecasts, active_subscribers: { withheld_reason: 'incomplete_history' }, monthly_list_price_run_rate: { withheld_reason: 'incomplete_history' } },
  synthetic: { businesses: { total: 0 }, subscriptions: { active: 0, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 }, members: { provisioned: 0 }, series, weekly_series: weeklySeries, active_plan_monthly_list_price_run_rate: [] },
};
const response = (data: unknown, status = 200, contentType = 'application/json') => new Response(JSON.stringify(data), { status, headers: { 'content-type': contentType } });
const options = (fetchImpl: typeof fetch, assertionSecret: string | undefined = secret, timeoutMs?: number) => ({
  baseUrl: 'https://business.test/', serviceAuth: async (id: string) => { expect(id).toBe(requestId); return 'Bearer internal'; },
  operatorAssertionSecret: assertionSecret, fetchImpl, timeoutMs,
});

function claimsFrom(headers: Headers): Record<string, unknown> {
  const token = headers.get('x-drezivo-operator-assertion')!;
  const [header, payload, signature] = token.split('.');
  expect(signature).toBe(createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${header}.${payload}`).digest('base64url'));
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('analytics read adapter', () => {
  it('uses the exact internal endpoint, binds canonical months, and validates the correlated DTO', async () => {
    let seen: Request | undefined;
    const adapter = createAnalyticsReadAdapter(options(async (input, init) => {
      seen = new Request(input, init);
      return response({ success: true, data: analytics, request_id: requestId });
    }));
    await expect(adapter.getAnalytics({ principal, months: 12, requestId })).resolves.toEqual(analytics);
    expect(seen!.url).toBe('https://business.test/internal/operator/v1/analytics?months=12');
    expect(seen!.headers.get('authorization')).toBe('Bearer internal');
    expect(seen!.headers.get('x-request-id')).toBe(requestId);
    const claims = claimsFrom(seen!.headers);
    expect(claims).toMatchObject({ permission: 'platform.analytics.read', method: 'GET', path: '/internal/operator/v1/analytics', request_id: requestId, role: 'billing_operator' });
    expect(claims.query_hash).toBe(createHash('sha256').update('months=12', 'utf8').digest('hex'));
    expect(claims).not.toHaveProperty('as_of');
  });

  it('fails before network access for absent assertion configuration or a disallowed role', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response({ success: true, data: analytics, request_id: requestId }); };
    await expect(createAnalyticsReadAdapter(options(fetchImpl, '')).getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' });
    const unsupported: SafeOperatorPrincipal = { ...principal, roles: ['support_operator'] };
    await expect(createAnalyticsReadAdapter(options(fetchImpl)).getAnalytics({ principal: unsupported, months: 12, requestId })).rejects.toMatchObject({ code: 'OPERATOR_AUTH_UNAVAILABLE' });
    expect(calls).toBe(0);
  });

  it('rejects malformed, extra-field, mismatched-window, and miscorrelated DTOs', async () => {
    const invalid = { ...analytics, unexpected: 'private' };
    const extra = createAnalyticsReadAdapter(options(async () => response({ success: true, data: invalid, request_id: requestId })));
    await expect(extra.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    const wrongWindow = createAnalyticsReadAdapter(options(async () => response({ success: true, data: { ...analytics, period: { ...analytics.period, months: 24 } }, request_id: requestId })));
    await expect(wrongWindow.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    const otherRequest = createAnalyticsReadAdapter(options(async () => response({ success: true, data: analytics, request_id: 'different-request' })));
    await expect(otherRequest.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('rejects omitted or extra weekly fields and malformed or incomplete ISO-week windows', async () => {
    const { weekly_series: _weekly, ...omittedWeekly } = analytics;
    const cases: unknown[] = [
      omittedWeekly,
      { ...analytics, weekly_series: { ...analytics.weekly_series, unexpected: true } },
      { ...analytics, weekly_series: { ...analytics.weekly_series, new_businesses: [{ ...weeklyCounts[0], week: '2026-W00' }, ...weeklyCounts.slice(1)] } },
      { ...analytics, weekly_series: { ...analytics.weekly_series, new_businesses: [{ ...weeklyCounts[0], week: '2021-W53' }, ...weeklyCounts.slice(1)] } },
      { ...analytics, weekly_series: { ...analytics.weekly_series, memberships: weeklyCounts.slice(1) } },
      { ...analytics, weekly_period: { ...analytics.weekly_period, weeks: 51 } },
      { ...analytics, weekly_period: { ...analytics.weekly_period, to: analytics.weekly_period.from } },
    ];
    for (const data of cases) {
      const adapter = createAnalyticsReadAdapter(options(async () => response({ success: true, data, request_id: requestId })));
      await expect(adapter.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    }
  });

  it('accepts the ISO week 53 rollover and the following ISO year week 1', async () => {
    const points = weeklyPoints('2020-W52');
    expect(points[0]?.week).toBe('2020-W52');
    expect(points[1]?.week).toBe('2020-W53');
    expect(points[2]?.week).toBe('2021-W01');
    const spanning = {
      ...analytics,
      weekly_period: { from: '2020-12-20T16:00:00.000Z', to: '2021-12-19T16:00:00.000Z', weeks: 52 as const },
      weekly_series: {
        ...analytics.weekly_series,
        new_businesses: points,
        memberships: points,
        subscription_events: [{ week: '2020-W53', event_type: 'trial_started' as const, count: 1 }],
      },
      synthetic: {
        ...analytics.synthetic,
        weekly_series: {
          ...analytics.synthetic.weekly_series,
          new_businesses: points,
          memberships: points,
          subscription_events: [],
        },
      },
    };
    const adapter = createAnalyticsReadAdapter(options(async () => response({ success: true, data: spanning, request_id: requestId })));
    await expect(adapter.getAnalytics({ principal, months: 12, requestId })).resolves.toEqual(spanning);
  });

  it('rejects forecast horizon gaps, duplicate horizons, wrong point counts, and nonconsecutive months', async () => {
    const standard = analytics.forecasts.new_businesses;
    const truncated = standard.slice(0, 3);
    const duplicate = [standard[0]!, standard[0]!, standard[2]!, standard[3]!];
    const wrongPointCount = [
      { horizon_months: 1, points: [{ month: '2026-09', count: 1 }] },
      { horizon_months: 3, points: [{ month: '2026-09', count: 1 }] },
      standard[2]!, standard[3]!,
    ];
    const nonconsecutive = [
      standard[0]!,
      { horizon_months: 3, points: [{ month: '2026-09', count: 1 }, { month: '2026-11', count: 2 }, { month: '2026-12', count: 3 }] },
      standard[2]!, standard[3]!,
    ];
    for (const newBusinesses of [truncated, duplicate, wrongPointCount, nonconsecutive]) {
      const data = { ...analytics, forecasts: { ...analytics.forecasts, new_businesses: newBusinesses } };
      const adapter = createAnalyticsReadAdapter(options(async () => response({ success: true, data, request_id: requestId })));
      await expect(adapter.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    }
  });

  it('requires zero-filled monthly series to match the selected completed month window', async () => {
    const shortened = { ...analytics, series: { ...analytics.series, new_businesses: analytics.series.new_businesses.slice(1) } };
    const adapter = createAnalyticsReadAdapter(options(async () => response({ success: true, data: shortened, request_id: requestId })));
    await expect(adapter.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
    const changedWindow = { ...analytics, period: { ...analytics.period, months: 24 } };
    const other = createAnalyticsReadAdapter(options(async () => response({ success: true, data: changedWindow, request_id: requestId })));
    await expect(other.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_INVALID_RESPONSE' });
  });

  it('maps timeout and upstream failures to safe dependency errors', async () => {
    const timeout = createAnalyticsReadAdapter(options(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private upstream timeout details')), { once: true });
    }), secret, 250));
    await expect(timeout.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    const upstreamFailure = createAnalyticsReadAdapter(options(async () => response({ private: 'body' }, 502)));
    await expect(upstreamFailure.getAnalytics({ principal, months: 12, requestId })).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
