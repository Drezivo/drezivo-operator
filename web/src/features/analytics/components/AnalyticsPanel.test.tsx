import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAnalyticsResponse } from "@/features/analytics/model";
import { AnalyticsPanel } from "@/features/analytics/components/AnalyticsPanel";

vi.mock("@/shared/ui/StatePanels", () => ({ EmptyPanel: ({ title, body }: { title: string; body: string }) => <div>{title} {body}</div> }));
afterEach(cleanup);

const monthlyPoints = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 8 + index, 1));
  return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, count: index < 4 ? 2 : 1 };
});
const weeklyPoints = Array.from({ length: 52 }, (_, index) => {
  const monday = new Date(Date.UTC(2025, 8, 22 + index * 7));
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000);
  const week = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
  return { week: `${year}-W${String(week).padStart(2, "0")}`, count: 0 };
});
const makeForecast = (horizon_months: number) => ({
  horizon_months,
  points: Array.from({ length: horizon_months }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8 + index, 1));
    return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, count: 1 };
  }),
});
const sample = parseAnalyticsResponse({
  as_of: "2026-09-25T00:00:00Z", timezone: "Asia/Manila",
  period: { from: "2025-08-31T16:00:00Z", to: "2026-08-31T16:00:00Z", months: 12 },
  weekly_period: { from: "2025-09-21T16:00:00Z", to: "2026-09-20T16:00:00Z", weeks: 52 },
  businesses: { total: 3 }, subscriptions: { active: 2, trialing: 1, past_due: 0, restricted: 0, cancelled: 0 }, members: { provisioned: 6 },
  active_plan_monthly_list_price_run_rate: [
    { currency: "PHP", amount_minor: "12000", active_subscription_count: 2 },
    { currency: "USD", amount_minor: "1000", active_subscription_count: 1 },
  ],
  series: {
    new_businesses: monthlyPoints, memberships: monthlyPoints.map((point) => ({ ...point, count: 0 })),
    subscription_events: ["trial_started", "past_due", "restricted", "plan_changed"].map((event_type, index) => ({ month: "2025-09", event_type, count: index + 1 })),
  },
  weekly_series: {
    new_businesses: weeklyPoints, memberships: weeklyPoints,
    subscription_events: ["trial_started", "past_due", "restricted", "plan_changed"].map((event_type, index) => ({ week: weeklyPoints[0]!.week, event_type, count: index + 1 })),
  },
  forecasts: {
    new_businesses: [1, 3, 6, 12].map(makeForecast),
    memberships: [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: "insufficient_history" })),
    active_subscribers: { withheld_reason: "incomplete_history" }, monthly_list_price_run_rate: { withheld_reason: "incomplete_history" },
  },
  synthetic: {
    businesses: { total: 99 }, subscriptions: { active: 99, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 }, members: { provisioned: 999 },
    series: { new_businesses: monthlyPoints, memberships: monthlyPoints, subscription_events: [] },
    weekly_series: { new_businesses: weeklyPoints, memberships: weeklyPoints, subscription_events: [] }, active_plan_monthly_list_price_run_rate: [],
  },
});

describe("AnalyticsPanel", () => {
  it("separates live metrics from synthetic sample and shows yearly partial-window rollups", () => {
    render(<AnalyticsPanel data={sample} months={12} onMonthsChange={vi.fn()} />);
    expect(screen.getByText("Provisioned memberships").parentElement).toHaveTextContent("6");
    expect(screen.getByText("Membership records, not unique users")).toBeInTheDocument();
    expect(screen.getByText("Paid businesses").parentElement).toHaveTextContent("Unavailable");
    expect(screen.queryByText("Cash collection")).not.toBeInTheDocument();
    expect(screen.queryByText("Active-plan list-price run-rate (pricing proxy)")).not.toBeInTheDocument();
    const synthetic = screen.getByText("Synthetic QA sample · separate from live metrics").closest("details")!;
    expect(within(synthetic).getByText("Synthetic-only data. These charts are kept separate from live history and forecasts.")).toBeInTheDocument();
    expect(within(synthetic).getByRole("heading", { name: "Synthetic new businesses by month" })).toBeInTheDocument();
    expect(within(synthetic).getByRole("heading", { name: "Synthetic new businesses by calendar year" })).toBeInTheDocument();
    expect(within(synthetic).queryByText("Business additions forecast")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New businesses by calendar year" })).toBeInTheDocument();
    const liveYearly = screen.getByRole("heading", { name: "New businesses by calendar year" }).closest("section")!;
    expect(within(liveYearly).getByLabelText("2025, Sep–Dec · partial: 8 businesses")).toBeInTheDocument();
    expect(within(liveYearly).getByLabelText("2026, Jan–Aug · partial: 8 businesses")).toBeInTheDocument();
    expect(screen.getAllByText("12 months", { selector: "strong" })).toHaveLength(2);
  });

  it("renders zero values as zero-height monthly bars", () => {
    render(<AnalyticsPanel data={sample} months={12} onMonthsChange={vi.fn()} />);
    const monthlyList = screen.getByRole("list", { name: "New businesses by month monthly values" });
    const membershipList = screen.getByRole("list", { name: "New memberships by month monthly values" });
    const monthlyBar = within(monthlyList).getByLabelText("2025-09: 2 businesses").querySelector(".bar-fill");
    const membershipZero = within(membershipList).getByLabelText("2025-09: 0 memberships").querySelector(".bar-fill");
    expect(monthlyBar).toHaveStyle({ height: "100%" });
    expect(membershipZero).toHaveStyle({ height: "0%" });
  });

  it("offers only the requested history choices and hides removed content", () => {
    const onMonthsChange = vi.fn();
    render(<AnalyticsPanel data={sample} months={12} onMonthsChange={onMonthsChange} />);
    const select = screen.getByLabelText("History");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["6 months", "12 months", "24 months"]);
    for (const months of [6, 12, 24]) fireEvent.change(select, { target: { value: String(months) } });
    expect(onMonthsChange.mock.calls.map(([value]) => value)).toEqual([6, 12, 24]);
    expect(screen.queryByText(/Source ingestion lag/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Monthly range:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Weekly range:/)).not.toBeInTheDocument();
    for (const title of ["New businesses by week", "New memberships by week", "Selected subscription events by month", "Selected subscription events by week"]) expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
  });

  it("explains forecast comparison and keeps withheld reasons visible", () => {
    const data = parseAnalyticsResponse({ ...sample, forecasts: {
      ...sample.forecasts,
      new_businesses: [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: horizon_months === 3 ? "baseline_not_beaten" : "insufficient_history" })),
    } });
    render(<AnalyticsPanel data={data} months={12} onMonthsChange={vi.fn()} />);
    expect(screen.getAllByText(/Seasonal-naive forecasts are evaluated against a last-value baseline and shown only after at least three rolling validation origins\./)).toHaveLength(2);
    expect(screen.getByText("Withheld: seasonal-naive did not beat the last-value baseline")).toBeInTheDocument();
    const businessForecast = screen.getByRole("heading", { name: "Business additions forecast" }).closest("section")!;
    const membershipForecast = screen.getByRole("heading", { name: "Membership additions forecast" }).closest("section")!;
    expect(within(businessForecast).getAllByText("Withheld: insufficient history")).toHaveLength(3);
    expect(within(membershipForecast).getAllByText("Withheld: insufficient history")).toHaveLength(4);
    expect(screen.getByText("Withheld: incomplete history. No forecast values are available because the API has incomplete history.")).toBeInTheDocument();
    expect(screen.getByText("Withheld: incomplete history. This active-plan list-price proxy is not collected income; forecast values are unavailable because the API has incomplete history.")).toBeInTheDocument();
  });

  it("renders returned 12-month forecast points as an accessible monthly chart and table", () => {
    const businessPoints = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8 + index, 1));
      return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, count: index + 1 };
    });
    const membershipPoints = businessPoints.map(({ month }, index) => ({ month, count: 12 - index }));
    const data = parseAnalyticsResponse({ ...sample, forecasts: {
      ...sample.forecasts,
      new_businesses: sample.forecasts.new_businesses.map((forecast) => forecast.horizon_months === 12 ? { horizon_months: 12, points: businessPoints } : forecast),
      memberships: sample.forecasts.memberships.map((forecast) => forecast.horizon_months === 12 ? { horizon_months: 12, points: membershipPoints } : forecast),
    } });
    render(<AnalyticsPanel data={data} months={12} onMonthsChange={vi.fn()} />);

    const businessCard = screen.getByRole("heading", { name: "Business additions forecast" }).closest("section")!;
    const businessChart = within(businessCard).getByRole("list", { name: "Business additions forecast 12-month monthly values" });
    const businessTable = within(businessCard).getByRole("table", { name: "Projected business additions by month" });
    expect(within(businessChart).getAllByRole("listitem")).toHaveLength(12);
    expect(within(businessTable).getAllByRole("row")).toHaveLength(13);
    businessPoints.forEach(({ month, count }) => {
      expect(within(businessChart).getByLabelText(`${month}: ${count} business additions`)).toBeInTheDocument();
      expect(within(businessTable).getByRole("row", { name: `${month} ${count}` })).toBeInTheDocument();
    });

    const membershipCard = screen.getByRole("heading", { name: "Membership additions forecast" }).closest("section")!;
    const membershipChart = within(membershipCard).getByRole("list", { name: "Membership additions forecast 12-month monthly values" });
    const membershipTable = within(membershipCard).getByRole("table", { name: "Projected membership additions by month" });
    membershipPoints.forEach(({ month, count }) => {
      expect(within(membershipChart).getByLabelText(`${month}: ${count} membership additions`)).toBeInTheDocument();
      expect(within(membershipTable).getByRole("row", { name: `${month} ${count}` })).toBeInTheDocument();
    });
    expect(within(businessCard).getByText("12 months")).toBeInTheDocument();
  });

  it("shows withheld monthly projections without inventing chart or table values", () => {
    render(<AnalyticsPanel data={sample} months={12} onMonthsChange={vi.fn()} />);
    const membershipCard = screen.getByRole("heading", { name: "Membership additions forecast" }).closest("section")!;
    expect(within(membershipCard).getByText("12-month monthly projection: Withheld: insufficient history.")).toBeInTheDocument();
    expect(within(membershipCard).queryByRole("table")).not.toBeInTheDocument();
    expect(within(membershipCard).queryByRole("list", { name: "Membership additions forecast 12-month monthly values" })).not.toBeInTheDocument();
    expect(screen.getByText(/Active-subscriber forecast/).parentElement).toHaveTextContent("Withheld: incomplete history");
    expect(screen.getByText(/List-price run-rate forecast/).parentElement).toHaveTextContent("Withheld: incomplete history");
  });

  it("handles an empty 12-month point array without displaying a fabricated zero forecast", () => {
    const data = { ...sample, forecasts: {
      ...sample.forecasts,
      new_businesses: sample.forecasts.new_businesses.map((forecast) => forecast.horizon_months === 12 ? { horizon_months: 12 as const, points: [] } : forecast),
    } };
    render(<AnalyticsPanel data={data} months={12} onMonthsChange={vi.fn()} />);
    const businessCard = screen.getByRole("heading", { name: "Business additions forecast" }).closest("section")!;
    expect(within(businessCard).getByText("12-month monthly projection: Withheld: no monthly projection points returned.")).toBeInTheDocument();
    expect(within(businessCard).queryByRole("table")).not.toBeInTheDocument();
  });
});
