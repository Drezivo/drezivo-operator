import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { OverviewPanel } from "./OverviewPanel";

function overviewData() {
  return {
    as_of: "2026-09-25T00:00:00Z",
    businesses: { total: 8, by_status: [{ status: "active", count: 6 }, { status: "restricted", count: 1 }, { status: "missing", count: 1 }] },
    subscriptions: {
      active: 5, trial: 1, grace: 2, past_due: 1, restricted: 1, cancelled: 2, missing: 1,
      lifecycle: { expired_trials: 3, expired_grace: 4, incomplete_trials: 5, incomplete_grace: 6 },
    },
    attention: { failed_jobs: 2, failed_notifications: 1, active_support_grants: 3 },
    recent_businesses: [{ id: "biz_1", name: "Northstar Homes", slug: "northstar-homes", status: "active", created_at: "2026-09-24T16:00:00Z" }],
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("API states", () => {
  it("announces loading accessibly", () => {
    render(<LoadingPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading from operator API");
  });

  it("shows a genuine empty response without inventing records", () => {
    render(<EmptyPanel />);
    expect(screen.getByRole("heading", { name: "No records returned" })).toBeInTheDocument();
    expect(screen.getByText("The API returned an empty collection for this view.")).toBeInTheDocument();
  });

  it("shows a successful request ID and copies it when the clipboard is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<RequestId requestId="req_success_123" />);

    expect(screen.getByText("req_success_123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("status");
    expect(writeText).toHaveBeenCalledWith("req_success_123");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("distinguishes API authorization denial and permits a retry", () => {
    const retry = vi.fn();
    render(<StatePanel error={new ApiError("Access denied", "forbidden", 403, "OPERATOR_ACCESS_DENIED", "req_3")} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Operator access not granted");
    expect(screen.getByRole("alert")).toHaveTextContent("req_3");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    ["Business API", "SERVICE_UNAVAILABLE", "req_business_503"],
    ["Clerk operator directory", "DEPENDENCY_UNAVAILABLE", "req_directory_503"],
  ] as const)("names the known %s dependency on a 503 and retains its request ID", (dependency, code, requestId) => {
    render(<StatePanel error={new ApiError("Dependency unavailable", "unavailable", 503, code, requestId)} dependency={dependency} onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(`${dependency} could not provide this view`);
    expect(screen.getByRole("alert")).toHaveTextContent(`This view needs data from ${dependency}`);
    expect(screen.getByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByRole("alert")).toHaveTextContent(requestId);
    expect(screen.getByRole("alert")).not.toHaveTextContent("localhost");
  });

  it("identifies an invalid dependency response instead of reporting it as unavailable", () => {
    render(<StatePanel error={new ApiError("Dependency response invalid", "unavailable", 503, "DEPENDENCY_INVALID_RESPONSE", "req_invalid_dependency")} dependency="Business API" onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Business API returned data we could not verify");
    expect(screen.getByRole("alert")).toHaveTextContent("its response failed validation");
    expect(screen.getByRole("alert")).toHaveTextContent("req_invalid_dependency");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Business API could not provide this view");
  });

  it("does not guess a dependency for a generic unavailable response", () => {
    render(<StatePanel error={new ApiError("Unavailable", "unavailable", 503, "SERVICE_UNAVAILABLE", "req_ambiguous_503")} onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("This request is temporarily unavailable");
    expect(screen.getByRole("alert")).toHaveTextContent("req_ambiguous_503");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Business API");
  });

  it("renders the approved overview totals and recent business fields", () => {
    render(<OverviewPanel data={overviewData()} />);
    expect(screen.getByText("Northstar Homes")).toBeInTheDocument();
    expect(screen.getByText("northstar-homes")).toBeInTheDocument();
    expect(screen.getByText(/Snapshot as of.*Asia\/Manila/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Business" })).toBeInTheDocument();
    expect(screen.getByText("Active support grants")).toBeInTheDocument();
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
