import { describe, expect, it } from "vitest";
import { formatMinorAmount, parseAnalyticsResponse } from "./analytics";

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function monthPoints(startYear: number, startMonth: number, length: number, count = 0) {
  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1));
    return { month: monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1), count };
  });
}
function weekKey(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000);
  const week = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
function weekPoints(length = 52) {
  const start = new Date(Date.UTC(2025, 8, 22));
  return Array.from({ length }, (_, index) => ({ week: weekKey(new Date(start.getTime() + index * 7 * 86_400_000)), count: 0 }));
}
function forecast(horizon: number) {
  return { horizon_months: horizon, points: monthPoints(2026, 9, horizon, 0) };
}
function fixture() {
  const months = monthPoints(2025, 9, 12);
  const weeks = weekPoints();
  return {
    as_of: "2026-09-25T00:00:00Z",
    timezone: "Asia/Manila",
    period: { from: "2025-08-31T16:00:00Z", to: "2026-08-31T16:00:00Z", months: 12 },
    weekly_period: { from: "2025-09-21T16:00:00Z", to: "2026-09-20T16:00:00Z", weeks: 52 },
    businesses: { total: 3 },
    subscriptions: { active: 2, trialing: 1, past_due: 0, restricted: 0, cancelled: 0 },
    members: { provisioned: 6 },
    active_plan_monthly_list_price_run_rate: [{ currency: "PHP", amount_minor: "12000", active_subscription_count: 2 }],
    series: { new_businesses: months, memberships: months, subscription_events: [] },
    weekly_series: { new_businesses: weeks, memberships: weeks, subscription_events: [] },
    forecasts: {
      new_businesses: [1, 3, 6, 12].map(forecast),
      memberships: [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: "insufficient_history" })),
      active_subscribers: { withheld_reason: "incomplete_history" },
      monthly_list_price_run_rate: { withheld_reason: "incomplete_history" },
    },
    synthetic: {
      businesses: { total: 99 },
      subscriptions: { active: 99, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 },
      members: { provisioned: 999 },
      series: { new_businesses: months, memberships: months, subscription_events: [] },
      weekly_series: { new_businesses: weeks, memberships: weeks, subscription_events: [] },
      active_plan_monthly_list_price_run_rate: [],
    },
  };
}
const parsedFixture = () => parseAnalyticsResponse(fixture());

describe("parseAnalyticsResponse", () => {
  it("accepts complete monthly and Manila ISO-week windows and ordered forecasts", () => {
    expect(parsedFixture().weekly_series.new_businesses).toHaveLength(52);
  });

  it("rejects omitted or extra response and weekly shape fields", () => {
    const omitted = fixture();
    delete (omitted as { weekly_period?: unknown }).weekly_period;
    expect(() => parseAnalyticsResponse(omitted)).toThrow();
    const extra = fixture();
    (extra.weekly_series as unknown as Record<string, unknown>).extra = [];
    expect(() => parseAnalyticsResponse(extra)).toThrow();
  });

  it("rejects non-finite and unsafe counts and malformed count DTOs", () => {
    const bad = fixture();
    bad.businesses.total = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseAnalyticsResponse(bad)).toThrow();
    const nonFinite = fixture();
    nonFinite.series.new_businesses[0]!.count = Number.POSITIVE_INFINITY;
    expect(() => parseAnalyticsResponse(nonFinite)).toThrow();
  });

  it("requires the complete contiguous selected monthly window and increasing period boundaries", () => {
    const gap = fixture();
    gap.series.new_businesses[5]!.month = "2026-01";
    expect(() => parseAnalyticsResponse(gap)).toThrow();
    const truncated = fixture();
    truncated.synthetic.series.memberships.pop();
    expect(() => parseAnalyticsResponse(truncated)).toThrow();
    const changedWindow = fixture();
    changedWindow.period.to = "2026-08-30T16:00:00Z";
    expect(() => parseAnalyticsResponse(changedWindow)).toThrow();
  });

  it("requires exactly 52 consecutive Manila Monday weeks and rejects impossible W53", () => {
    const truncated = fixture();
    truncated.weekly_series.new_businesses.pop();
    expect(() => parseAnalyticsResponse(truncated)).toThrow();
    const impossible = fixture();
    impossible.weekly_series.memberships[10]!.week = "2021-W53";
    expect(() => parseAnalyticsResponse(impossible)).toThrow();
    const changedWindow = fixture();
    changedWindow.weekly_period.to = "2026-09-21T16:00:00Z";
    expect(() => parseAnalyticsResponse(changedWindow)).toThrow();
  });

  it("rejects truncated, duplicate, out-of-order, or structurally invalid forecast horizons", () => {
    const truncated = fixture();
    truncated.forecasts.new_businesses[1] = { horizon_months: 3, points: monthPoints(2026, 9, 2) };
    expect(() => parseAnalyticsResponse(truncated)).toThrow();
    const duplicate = fixture();
    duplicate.forecasts.memberships[2] = { ...duplicate.forecasts.memberships[1]! };
    expect(() => parseAnalyticsResponse(duplicate)).toThrow();
    const gap = fixture();
    gap.forecasts.new_businesses[3]!.points[4]!.month = "2027-02";
    expect(() => parseAnalyticsResponse(gap)).toThrow();
    const both = fixture();
    (both.forecasts.memberships[0] as Record<string, unknown>).points = monthPoints(2026, 9, 1);
    expect(() => parseAnalyticsResponse(both)).toThrow();
  });

  it("accepts the first future month at period.to and rejects historical or shifted forecast starts", () => {
    expect(() => parseAnalyticsResponse(fixture())).not.toThrow();
    const historical = fixture();
    historical.forecasts.new_businesses[0]!.points[0]!.month = "2026-08";
    expect(() => parseAnalyticsResponse(historical)).toThrow();
    const shifted = fixture();
    (shifted.forecasts.memberships as unknown[])[1] = { horizon_months: 3, points: monthPoints(2026, 10, 3) };
    expect(() => parseAnalyticsResponse(shifted)).toThrow();
  });

  it("rejects unsafe minor-unit strings while formatting large exact amounts without Number conversion", () => {
    expect(formatMinorAmount("900719925474099312345", "PHP")).toContain("9,007,199,254,740,993,123.45");
    const duplicateCurrency = fixture();
    duplicateCurrency.active_plan_monthly_list_price_run_rate.push({ currency: "PHP", amount_minor: "2", active_subscription_count: 1 });
    expect(() => parseAnalyticsResponse(duplicateCurrency)).toThrow();
    const oversizedAmount = fixture();
    oversizedAmount.active_plan_monthly_list_price_run_rate[0]!.amount_minor = "9".repeat(129);
    expect(() => parseAnalyticsResponse(oversizedAmount)).toThrow();
  });
});
