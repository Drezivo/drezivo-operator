import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedConsole } from "./AuthenticatedConsole";

const mocks = vi.hoisted(() => ({
  query: "",
  getToken: vi.fn().mockResolvedValue("operator-session-token"),
  signOut: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, getToken: mocks.getToken, signOut: mocks.signOut, userId: "operator-user", orgId: "operator-org" }),
  RedirectToSignIn: () => null,
  OrganizationList: () => null,
  OrganizationSwitcher: () => null,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.query),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, scroll: _scroll, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) => <a href={href as string} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));

function overviewEnvelope(recentBusinessName?: string, requestId = "req_overview_test") {
  return new Response(JSON.stringify({
    success: true,
    request_id: requestId,
    data: {
      as_of: "2026-09-25T00:00:00Z",
      businesses: { total: 0, by_status: [] },
      subscriptions: { active: 0, trial: 0, grace: 0, past_due: 0, restricted: 0, cancelled: 0, missing: 0, lifecycle: {} },
      attention: { failed_jobs: 0, failed_notifications: 0, active_support_grants: 0 },
      recent_businesses: recentBusinessName ? [{
        id: "00000000-0000-4000-8000-000000000003",
        name: recentBusinessName,
        slug: recentBusinessName.toLowerCase().replaceAll(" ", "-"),
        status: "active",
        created_at: "2026-09-24T00:00:00Z",
      }] : [],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function responseEnvelope(data: unknown, requestId: string) {
  return new Response(JSON.stringify({ success: true, request_id: requestId, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function analyticsEnvelope() {
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 8 + index, 1));
    return { month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, count: 0 };
  });
  const weeks = Array.from({ length: 52 }, (_, index) => {
    const monday = new Date(Date.UTC(2025, 8, 22 + index * 7));
    const thursday = new Date(monday.getTime() + 3 * 86_400_000);
    const year = thursday.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const firstMonday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86_400_000);
    const week = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86_400_000)) + 1;
    return { week: `${year}-W${String(week).padStart(2, "0")}`, count: 0 };
  });
  return responseEnvelope({
    as_of: "2026-09-25T00:00:00Z", timezone: "Asia/Manila", period: { from: "2025-08-31T16:00:00Z", to: "2026-08-31T16:00:00Z", months: 12 }, weekly_period: { from: "2025-09-21T16:00:00Z", to: "2026-09-20T16:00:00Z", weeks: 52 },
    businesses: { total: 3 }, subscriptions: { active: 2, trialing: 1, past_due: 0, restricted: 0, cancelled: 0 }, members: { provisioned: 6 },
    active_plan_monthly_list_price_run_rate: [], series: { new_businesses: months, memberships: months, subscription_events: [] }, weekly_series: { new_businesses: weeks, memberships: weeks, subscription_events: [] },
    forecasts: { new_businesses: [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: "insufficient_history" })), memberships: [1, 3, 6, 12].map((horizon_months) => ({ horizon_months, withheld_reason: "insufficient_history" })), active_subscribers: { withheld_reason: "incomplete_history" }, monthly_list_price_run_rate: { withheld_reason: "incomplete_history" } },
    synthetic: { businesses: { total: 0 }, subscriptions: { active: 0, trialing: 0, past_due: 0, restricted: 0, cancelled: 0 }, members: { provisioned: 0 }, series: { new_businesses: months, memberships: months, subscription_events: [] }, weekly_series: { new_businesses: weeks, memberships: weeks, subscription_events: [] }, active_plan_monthly_list_price_run_rate: [] },
  }, "req_analytics_test");
}

beforeEach(() => {
  mocks.query = "";
  mocks.getToken.mockReset().mockResolvedValue("operator-session-token");
  mocks.signOut.mockClear();
  vi.stubEnv("NEXT_PUBLIC_DREZIVO_API_BASE_URL", "http://localhost:5080/api/v1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AuthenticatedConsole view routing", () => {
  it.each(["view=", "view=unknown", "view=overview&view=unknown"]) ("rejects %s without requesting the API", async (query) => {
    mocks.query = query;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthenticatedConsole />);

    expect(await screen.findByRole("alert")).toHaveTextContent("This console view is not supported");
    expect(screen.getByRole("heading", { name: "Unsupported view" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("uses Overview when the view parameter is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(overviewEnvelope());
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthenticatedConsole />);

    expect(await screen.findByText(/Snapshot as of/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:5080/api/v1/overview");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer operator-session-token");
  });

  it("requests the selected monthly analytics window with the Clerk token", async () => {
    mocks.query = "view=analytics&months=12";
    const fetchMock = vi.fn().mockResolvedValue(analyticsEnvelope());
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthenticatedConsole />);

    expect(await screen.findByRole("heading", { name: "New businesses by week" })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:5080/api/v1/analytics?months=12");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer operator-session-token");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
  });

  it("shows a recoverable session error and does not fetch when Clerk returns no token", async () => {
    mocks.getToken.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthenticatedConsole />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Your session needs attention");
    expect(screen.getByText("Sign in again to continue. No data was loaded for this request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a clearable no-match state when navigation search finds no view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(overviewEnvelope()));
    render(<AuthenticatedConsole />);

    expect(await screen.findByText(/Snapshot as of/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter navigation" }), { target: { value: "no such view" } });

    expect(screen.getByRole("status")).toHaveTextContent("No views match “no such view”.");
    fireEvent.click(screen.getByRole("button", { name: "Clear navigation filter" }));
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByText(/No views match/)).not.toBeInTheDocument();
  });

  it("links recent overview businesses to the existing business detail view", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(overviewEnvelope("Acme Rentals"))
      .mockResolvedValueOnce(responseEnvelope({ items: [{ id: "00000000-0000-4000-8000-000000000003", name: "Acme Rentals" }] }, "req_business_details"));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<AuthenticatedConsole />);

    const businessLink = await screen.findByRole("link", { name: "View business Acme Rentals" });
    expect(businessLink).toHaveAttribute("href", "/?view=businesses&businessId=00000000-0000-4000-8000-000000000003");
    expect(screen.getByText("Active", { selector: ".status-badge" })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    navigation.scrollTop = 84;
    fireEvent.scroll(navigation);
    fireEvent.click(businessLink);
    navigation.scrollTop = 0;
    mocks.query = "view=businesses&businessId=00000000-0000-4000-8000-000000000003";
    rerender(<AuthenticatedConsole />);

    expect(screen.getByRole("heading", { name: "Business details" })).toBeInTheDocument();
    expect(navigation.scrollTop).toBe(84);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://localhost:5080/api/v1/businesses/00000000-0000-4000-8000-000000000003");
  });

  it("focuses each changed page heading while preserving the navigation shell and scroll position", () => {
    mocks.query = "view=audit";
    vi.stubGlobal("fetch", vi.fn());
    const { rerender } = render(<AuthenticatedConsole />);
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    navigation.scrollTop = 84;
    fireEvent.scroll(navigation);

    mocks.query = "view=support";
    rerender(<AuthenticatedConsole />);

    expect(screen.getByRole("heading", { name: "Support activity" })).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBe(navigation);
    expect(navigation.scrollTop).toBe(84);

    // A second URL change models browser Back/Forward updating useSearchParams.
    mocks.query = "view=audit";
    rerender(<AuthenticatedConsole />);

    expect(screen.getByRole("heading", { name: "Audit log" })).toHaveFocus();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBe(navigation);
    expect(navigation.scrollTop).toBe(84);
  });

  it("disables refresh while pending and ignores a double click before React rerenders", async () => {
    let finishRefresh: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(overviewEnvelope())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthenticatedConsole />);
    expect(await screen.findByText(/Snapshot as of/)).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Refresh data" });
    act(() => {
      fireEvent.click(refreshButton);
      fireEvent.click(refreshButton);
    });

    const pendingButton = screen.getByRole("button", { name: "Refreshing data" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => { finishRefresh?.(overviewEnvelope()); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh data" })).toBeEnabled());
  });

  it("does not let a refresh response from a previous view overwrite the selected view", async () => {
    let finishOldRefresh: ((response: Response) => void) | undefined;
    let oldRefreshSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(overviewEnvelope())
      .mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
        oldRefreshSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((resolve) => { finishOldRefresh = resolve; });
      })
      .mockResolvedValueOnce(responseEnvelope({
        items: [{ tenant_id: "00000000-0000-4000-8000-000000000001", business_name: "Newest business" }],
        next_cursor: null,
      }, "req_business_test"));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<AuthenticatedConsole />);
    expect(await screen.findByText(/Snapshot as of/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    mocks.query = "view=businesses";
    rerender(<AuthenticatedConsole />);
    expect(oldRefreshSignal?.aborted).toBe(true);
    expect(await screen.findByText("Newest business")).toBeInTheDocument();

    const staleOverview = {
      as_of: "2026-09-25T00:00:00Z",
      businesses: { total: 1, by_status: [{ status: "active", count: 1 }, { status: "restricted", count: 0 }, { status: "cancelled", count: 0 }] },
      subscriptions: { active: 0, trial: 0, grace: 0, past_due: 0, restricted: 0, cancelled: 0, missing: 0, lifecycle: { expired_trials: 0, expired_grace: 0, incomplete_trials: 0, incomplete_grace: 0 } },
      attention: { failed_jobs: 0, failed_notifications: 0, active_support_grants: 0 },
      recent_businesses: [{ id: "00000000-0000-4000-8000-000000000002", name: "Stale overview", slug: "stale", status: "active", created_at: "2026-09-24T00:00:00Z" }],
    };
    await act(async () => { finishOldRefresh?.(responseEnvelope(staleOverview, "req_stale_test")); });

    expect(screen.getByRole("heading", { name: "Businesses" })).toBeInTheDocument();
    expect(screen.getByText("Newest business")).toBeInTheDocument();
    expect(screen.queryByText("Stale overview")).not.toBeInTheDocument();
  });

  it("lets the newest same-view refresh win even when the aborted request resolves last", async () => {
    let finishInitialRequest: ((response: Response) => void) | undefined;
    let initialSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
        initialSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((resolve) => { finishInitialRequest = resolve; });
      })
      .mockResolvedValueOnce(overviewEnvelope("Newest response", "req_newer_test"));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthenticatedConsole />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
    expect(initialSignal?.aborted).toBe(true);
    expect(await screen.findByText("Newest response")).toBeInTheDocument();

    await act(async () => { finishInitialRequest?.(overviewEnvelope("Older response", "req_older_test")); });

    expect(screen.getByText("Newest response")).toBeInTheDocument();
    expect(screen.queryByText("Older response")).not.toBeInTheDocument();
  });

  it("aborts the active view request on unmount", async () => {
    let finishRequest: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => { finishRequest = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<AuthenticatedConsole />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    unmount();

    expect(requestSignal?.aborted).toBe(true);
    await act(async () => { finishRequest?.(overviewEnvelope("Late response", "req_unmounted_test")); });
  });
});
