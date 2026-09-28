import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPanel } from "./ClientsPanel";
import { clientAttention, endOfManilaDay, formatManila, type ClientDetail } from "@/lib/clients";

const tenantId = "11111111-1111-4111-8111-111111111111";
const memberId = "33333333-3333-4333-8333-333333333333";
const detail: ClientDetail = {
  tenant_id: tenantId, name: "Luna Gowns", slug: "luna-gowns", status: "active", timezone: "Asia/Manila", created_at: "2026-09-20T02:00:00Z",
  subscription: { status: "trialing", plan_code: "starter", trial_ends_at: "2026-10-04T15:59:59Z", grace_ends_at: null, current_period_end: "2026-10-04T15:59:59Z" },
  member_counts: { active: 1, suspended: 0, removed: 0 },
  members: [{ membership_id: memberId, clerk_user_id: "user_owner_a", role: "owner", status: "active", created_at: "2026-09-20T02:00:00Z" }],
  recent_audit: [{ occurred_at: "2026-09-21T01:00:00Z", actor_kind: "staff", action: "catalogue.item.created", entity_type: "product", outcome: "succeeded" }],
};
const envelope = (data: unknown, requestId = "req_test") => new Response(JSON.stringify({ success: true, request_id: requestId, data }), { status: 200 });
const getToken = vi.fn().mockResolvedValue("operator-session-token");

beforeEach(() => {
  process.env.NEXT_PUBLIC_DREZIVO_API_BASE_URL = "http://localhost:5080/api/v1";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("client helpers", () => {
  it("turns a date input into the end of that Manila day and rejects junk", () => {
    expect(endOfManilaDay("2026-10-20")).toBe("2026-10-20T23:59:59+08:00");
    expect(endOfManilaDay("20/10/2026")).toBeNull();
  });
  it("formats instants in Manila time", () => {
    expect(formatManila("2026-10-04T15:59:59Z")).toContain("Oct");
    expect(formatManila(null)).toBe("—");
  });
  it("explains the client state in one sentence", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(clientAttention(detail, now)).toBe("Trial: 4 days left");
    expect(clientAttention({ ...detail, status: "restricted" }, now)).toBe("Locked by an operator");
    expect(clientAttention({ ...detail, status: "restricted", subscription: { ...detail.subscription!, status: "restricted" } }, now)).toContain("staff cannot make changes");
  });
});

describe("ClientsPanel", () => {
  it("lists businesses and opens the manage view", async () => {
    mockFetch((url) => url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope(detail));
    render(<ClientsPanel getToken={getToken} />);
    expect(await screen.findByText("Luna Gowns")).toBeInTheDocument();
    expect(screen.getByText("/s/luna-gowns")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText("People with access")).toBeInTheDocument();
    expect(screen.getByText("user_owner_a")).toBeInTheDocument();
    expect(screen.getByText("catalogue.item.created")).toBeInTheDocument();
  });

  it("filters the list by name, slug or ID", async () => {
    mockFetch(() => envelope({ items: [detail, { ...detail, tenant_id: "22222222-2222-4222-8222-222222222222", name: "Barong Hub", slug: "barong-hub" }] }));
    render(<ClientsPanel getToken={getToken} />);
    await screen.findByText("Barong Hub");
    fireEvent.change(screen.getByLabelText("Find a business"), { target: { value: "barong" } });
    expect(screen.queryByText("Luna Gowns")).not.toBeInTheDocument();
    expect(screen.getByText("Barong Hub")).toBeInTheDocument();
  });

  it("locks once on a double click, sends reason and Idempotency-Key, and reuses the key on retry", async () => {
    const commands: Array<{ key: string | null; body: string }> = [];
    let failNext = true;
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        commands.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: String(init.body) });
        if (failNext) { failNext = false; return new Response(JSON.stringify({ success: false, request_id: "req_fail", error: { code: "DEPENDENCY_UNAVAILABLE", message: "Business administration is temporarily unavailable." } }), { status: 503 }); }
        return envelope({ tenant: { ...detail, status: "restricted" }, changed: true, replayed: false }, "req_lock");
      }
      return url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope(detail);
    });
    render(<ClientsPanel getToken={getToken} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    await screen.findByText("People with access");
    const lockCard = screen.getByRole("heading", { name: "Lock business" }).closest("section")!;
    fireEvent.change(lockCard.querySelector("textarea")!, { target: { value: "Unpaid invoice" } });
    const lockButton = lockCard.querySelector("button[type=submit]") as HTMLButtonElement;
    fireEvent.click(lockButton);
    fireEvent.click(lockButton);
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(await screen.findByText(/could not provide this view/)).toBeInTheDocument();
    expect(JSON.parse(commands[0]!.body)).toEqual({ reason: "Unpaid invoice" });
    fireEvent.click(lockButton);
    await screen.findByText(/Business locked\./);
    expect(commands).toHaveLength(2);
    expect(commands[0]!.key).toBeTruthy();
    expect(commands[1]!.key).toBe(commands[0]!.key);
  });

  it("sends the trial end as the last second of the chosen Manila day", async () => {
    let sent: Record<string, unknown> | null = null;
    mockFetch(async (url, init) => {
      if (init.method === "POST") { sent = JSON.parse(String(init.body)); return envelope({ tenant: detail, changed: true, replayed: false }); }
      return url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope(detail);
    });
    render(<ClientsPanel getToken={getToken} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    const trialCard = (await screen.findByRole("heading", { name: "Set trial end" })).closest("section")!;
    fireEvent.change(trialCard.querySelector("input[type=date]")!, { target: { value: "2026-10-20" } });
    fireEvent.change(trialCard.querySelector("textarea")!, { target: { value: "Pilot extension" } });
    fireEvent.click(trialCard.querySelector("button[type=submit]")!);
    await screen.findByText(/Trial end saved\./);
    expect(sent).toEqual({ trial_ends_at: "2026-10-20T23:59:59+08:00", reason: "Pilot extension" });
  });

  it("suspends a staff member with a reason", async () => {
    const paths: string[] = [];
    mockFetch(async (url, init) => {
      if (init.method === "POST") { paths.push(url); return envelope({ tenant: { ...detail, members: [{ ...detail.members[0]!, status: "suspended" }] }, changed: true, replayed: false }); }
      return url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope(detail);
    });
    render(<ClientsPanel getToken={getToken} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Left the shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspend" }));
    await screen.findByText(/Staff member suspended\./);
    expect(paths[0]).toContain(`/tenants/${tenantId}/members/${memberId}/suspend`);
  });

  it("shows the API failure state when the list cannot load", async () => {
    mockFetch(() => new Response(JSON.stringify({ success: false, request_id: "req_x", error: { code: "DEPENDENCY_UNAVAILABLE", message: "Business administration is not configured." } }), { status: 503 }));
    render(<ClientsPanel getToken={getToken} />);
    expect(await screen.findByText(/could not provide this view/)).toBeInTheDocument();
  });
});
