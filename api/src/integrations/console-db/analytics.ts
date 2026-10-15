import { z } from 'zod';
import { operatorAnalyticsResponse, type OperatorAnalyticsResponse } from '../../operator-analytics/index.js';
const point = z.object({ at: z.string(), count: z.number().int().nonnegative() });
const snapshot = z.object({ businesses: z.array(point), memberships: z.array(point), events: z.array(point.extend({ event_type: z.enum(['trial_started', 'past_due', 'restricted', 'plan_changed']) })), subscriptions: z.object({ active: z.number(), trialing: z.number(), past_due: z.number(), restricted: z.number(), cancelled: z.number() }), run_rate: z.array(z.object({ currency: z.string(), amount_minor: z.string(), active_subscription_count: z.number() })) });
const day = 86400000, offset = 8 * 3600000;
const month = (d: Date) => d.toISOString().slice(0, 7);
function week(ms: number): string { const d = new Date(ms); d.setUTCDate(d.getUTCDate() + 3); const year = d.getUTCFullYear(); const jan4 = new Date(Date.UTC(year, 0, 4)); const monday = +jan4 - ((jan4.getUTCDay() || 7) - 1) * day; return `${year}-W${String(1 + Math.floor((ms - monday) / (7 * day))).padStart(2, '0')}`; }
export function buildAnalytics(raw: unknown, requestedMonths: number, now = new Date(), synthetic = false): OperatorAnalyticsResponse {
    const months = z.union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)]).parse(requestedMonths);
    const s = snapshot.parse(raw), local = new Date(+now + offset);
    const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1), start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - months, 1);
    const thisMonday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ((local.getUTCDay() || 7) - 1) * day;
    const keys = Array.from({ length: months }, (_, i) => month(new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - months + i, 1))));
    const weeks = Array.from({ length: 52 }, (_, i) => ({ key: week(thisMonday - (52 - i) * 7 * day), at: thisMonday - (52 - i) * 7 * day }));
    const sum = (rows: typeof s.businesses) => rows.reduce((n, p) => n + p.count, 0);
    const monthly = (rows: typeof s.businesses) => keys.map(m => ({ month: m, count: sum(rows.filter(p => p.at.startsWith(m))) }));
    const weekly = (rows: typeof s.businesses) => weeks.map(w => ({ week: w.key, count: sum(rows.filter(p => { const at = Date.parse(p.at); return at >= w.at && at < w.at + 7 * day; })) }));
    const eventTypes = ['trial_started', 'past_due', 'restricted', 'plan_changed'] as const;
    const series = { new_businesses: monthly(s.businesses), memberships: monthly(s.memberships), subscription_events: eventTypes.flatMap(event_type => monthly(s.events.filter(p => p.event_type === event_type)).map(p => ({ ...p, event_type }))) };
    const weekly_series = { new_businesses: weekly(s.businesses), memberships: weekly(s.memberships), subscription_events: eventTypes.flatMap(event_type => weekly(s.events.filter(p => p.event_type === event_type)).map(p => ({ ...p, event_type }))) };
    const forecasts = ([1, 3, 6, 12] as const).map(horizon_months => ({ horizon_months, withheld_reason: 'insufficient_history' as const }));
    const emptySeries = { new_businesses: monthly([]), memberships: monthly([]), subscription_events: [] };
    const emptyWeeks = { new_businesses: weekly([]), memberships: weekly([]), subscription_events: [] };
    const result = operatorAnalyticsResponse.parse({ as_of: now.toISOString(), timezone: 'Asia/Manila', period: { from: new Date(start - offset).toISOString(), to: new Date(end - offset).toISOString(), months }, weekly_period: { from: new Date(thisMonday - 52 * 7 * day - offset).toISOString(), to: new Date(thisMonday - offset).toISOString(), weeks: 52 },
        businesses: { total: sum(s.businesses) }, members: { provisioned: sum(s.memberships) }, subscriptions: s.subscriptions, active_plan_monthly_list_price_run_rate: s.run_rate, series, weekly_series,
        forecasts: { new_businesses: forecasts, memberships: forecasts, active_subscribers: { withheld_reason: 'incomplete_history' }, monthly_list_price_run_rate: { withheld_reason: 'incomplete_history' } },
        synthetic: { businesses: { total: 0 }, members: { provisioned: 0 }, subscriptions: { active: 0, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 }, series: emptySeries, weekly_series: emptyWeeks, active_plan_monthly_list_price_run_rate: [] } });
    if (synthetic) {
        result.synthetic = { businesses: result.businesses, members: result.members, subscriptions: result.subscriptions, series: result.series, weekly_series: result.weekly_series, active_plan_monthly_list_price_run_rate: result.active_plan_monthly_list_price_run_rate };
        result.businesses = { total: 0 };
        result.members = { provisioned: 0 };
        result.subscriptions = { active: 0, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 };
        result.series = emptySeries;
        result.weekly_series = emptyWeeks;
        result.active_plan_monthly_list_price_run_rate = [];
    }
    return result;
}
