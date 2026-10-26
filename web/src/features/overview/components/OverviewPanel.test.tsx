import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OverviewPanel } from "./OverviewPanel";

function overviewData() {
  return {
    as_of: "2026-09-25T00:00:00Z",
    businesses: { total: 8, by_status: [{ status: "active", count: 6 }, { status: "restricted", count: 1 }, { status: "missing", count: 1 }] },
    subscriptions: {
      active: 5, trial: 1, grace: 2, past_due: 1, restricted: 1, cancelled: 2, missing: 1,
      lifecycle: { expired_trials: 3, expired_grace: 4, incomplete_trials: 5, incomplete_grace: 6 },
    },
    attention: { failed_jobs: 2, failed_notifications: 1 },
    recent_businesses: [{ id: "biz_1", name: "Northstar Homes", slug: "northstar-homes", status: "active", created_at: "2026-09-24T16:00:00Z" }],
  };
}

afterEach(cleanup);
describe("OverviewPanel", () => {
  it("renders the approved overview totals and recent business fields", () => {
    render(<OverviewPanel data={overviewData()} />);
    expect(screen.getByText("Northstar Homes")).toBeInTheDocument();
    expect(screen.getByText("northstar-homes")).toBeInTheDocument();
    expect(screen.getByText(/Snapshot as of.*Asia\/Manila/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Business" })).toBeInTheDocument();
    expect(screen.getByText("Businesses")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("shows the existing empty state when recent businesses are empty", () => {
    const data = overviewData();
    data.recent_businesses = [];
    render(<OverviewPanel data={data} />);
    expect(screen.getByRole("heading", { name: "No recent businesses" })).toBeInTheDocument();
    expect(screen.getByText("The API returned no businesses for this snapshot.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("highlights subscription lifecycle anomalies and non-active states", () => {
    render(<OverviewPanel data={overviewData()} />);
    const lifecycle = screen.getByRole("region", { name: "Lifecycle and operations attention" });
    for (const label of ["Expired trials", "Expired grace periods", "Incomplete trials", "Incomplete grace periods"]) {
      expect(within(lifecycle).getByText(label)).toBeInTheDocument();
    }
    for (const [label, count] of [["Expired trials", "3"], ["Expired grace periods", "4"], ["Incomplete trials", "5"], ["Incomplete grace periods", "6"]]) {
      expect(within(lifecycle).getByText(label).closest("div")).toHaveTextContent(count);
    }
    const subscriptionCard = screen.getByRole("heading", { name: "Subscription status" }).closest(".content-card");
    expect(subscriptionCard).not.toBeNull();
    for (const label of ["Restricted", "Cancelled", "Missing subscription"]) expect(within(subscriptionCard as HTMLElement).getByText(label)).toBeInTheDocument();
  });

  it("does not render owner or customer personal details from extra API fields", () => {
    const data = overviewData();
    Object.assign(data.recent_businesses[0], {
      owner_email: "owner@example.test",
      customer_name: "Private Customer",
      customer_phone: "+639123456789",
      payment_method: "private-card-reference",
    });
    render(<OverviewPanel data={data} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("owner@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("Private Customer")).not.toBeInTheDocument();
    expect(screen.queryByText("+639123456789")).not.toBeInTheDocument();
    expect(screen.queryByText("private-card-reference")).not.toBeInTheDocument();
  });
});
