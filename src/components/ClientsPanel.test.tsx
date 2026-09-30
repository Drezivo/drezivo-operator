import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPanel, type ClientsNavigation, type ClientsTab } from "./ClientsPanel";
import { clientAttention, clientState, endOfManilaDay, formatManila, matchesFilter, type ClientDetail, type ClientFilter } from "@/lib/clients";

const tenantId = "11111111-1111-4111-8111-111111111111";
const memberId = "33333333-3333-4333-8333-333333333333";
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const detail: ClientDetail = {
  tenant_id: tenantId, name: "Luna Gowns", slug: "luna-gowns", status: "active", timezone: "Asia/Manila", created_at: "2026-09-20T02:00:00Z",
  subscription: { status: "trialing", plan_code: "starter", trial_ends_at: inDays(2), grace_ends_at: null, current_period_end: inDays(2) },
  member_counts: { active: 1, suspended: 0, removed: 0 },
  pending_payment: false,
  notes: [],
  payments: [],
  members: [{ membership_id: memberId, clerk_user_id: "user_owner_a", role: "owner", status: "active", created_at: "2026-09-20T02:00:00Z" }],
  recent_audit: [{ occurred_at: "2026-09-21T01:00:00Z", actor_kind: "staff", action: "catalogue.item.created", entity_type: "product", outcome: "succeeded" }],
};
const paid: ClientDetail = { ...detail, tenant_id: "22222222-2222-4222-8222-222222222222", name: "Barong Hub", slug: "barong-hub",
  subscription: { status: "active", plan_code: "starter", trial_ends_at: null, grace_ends_at: null, current_period_end: inDays(20) } };
const paymentId = "66666666-6666-4666-8666-666666666666";
const pendingPayment = {
  payment_id: paymentId, tenant_id: tenantId, tenant_name: "Luna Gowns", status: "pending" as const, amount_minor: "30000", currency: "PHP",
  reference: "GC-778899", method_label: "GCash", submitted_at: "2026-10-01T02:00:00Z", reviewed_at: null, reviewed_by: null, review_note: null, has_proof: true,
};
const envelope = (data: unknown, requestId = "req_test") => new Response(JSON.stringify({ success: true, request_id: requestId, data }), { status: 200 });
const getToken = vi.fn().mockResolvedValue("operator-session-token");

/** Holds navigation state the way the console shell does with the URL. */
function Harness({ initial = {} }: { initial?: { client?: string | null; tab?: ClientsTab; filter?: ClientFilter } }) {
  const [state, setState] = useState({ client: null as string | null, tab: "businesses" as ClientsTab, filter: "attention" as ClientFilter, ...initial });
  const navigate = (next: ClientsNavigation) => setState((current) => ({
    client: next.tab ? null : next.client !== undefined ? next.client : current.client,
    tab: next.tab ?? current.tab,
    filter: next.filter ?? current.filter,
  }));
  return <ClientsPanel getToken={getToken} clientId={state.client} tab={state.tab} filter={state.filter} onNavigate={navigate} />;
}

beforeEach(() => { process.env.NEXT_PUBLIC_DREZIVO_API_BASE_URL = "http://localhost:5080/api/v1"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const listAndDetail = (url: string) => url.endsWith("/tenants") ? envelope({ items: [detail, paid] }) : envelope(detail);

describe("client helpers", () => {
  it("turns a date input into the end of that Manila day and rejects junk", () => {
    expect(endOfManilaDay("2026-10-20")).toBe("2026-10-20T23:59:59+08:00");
    expect(endOfManilaDay("20/10/2026")).toBeNull();
  });
  it("formats instants in Manila time", () => {
    expect(formatManila("2026-10-04T15:59:59Z")).toContain("Oct");
    expect(formatManila(null)).toBe("—");
  });
  it("gives each business one operator-facing state and triage group", () => {
    const now = new Date();
    expect(clientState(detail)).toBe("trial");
    expect(clientState({ ...detail, status: "restricted" })).toBe("locked");
    expect(clientState({ ...detail, status: "restricted", subscription: { ...detail.subscription!, status: "restricted" } })).toBe("restricted");
    expect(clientState(paid)).toBe("paid");
    expect(matchesFilter(detail, "attention", now)).toBe(true);
    expect(matchesFilter(paid, "attention", now)).toBe(false);
    expect(clientAttention(paid, now)).toContain("Paid until");
  });
});

describe("pilot access states", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const withSub = (subscription: Partial<NonNullable<ClientDetail["subscription"]>>, extra: Partial<ClientDetail> = {}): ClientDetail =>
    ({ ...detail, ...extra, subscription: { ...detail.subscription!, ...subscription } });

  it("follows the business API timeline: trial, view-only, storefront offline, expired", () => {
    const trialEnd = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
    expect(clientState(withSub({ trial_ends_at: trialEnd(5) }), now)).toBe("trial");
    expect(clientState(withSub({ trial_ends_at: trialEnd(-1) }), now)).toBe("view_only");
    expect(clientAttention(withSub({ trial_ends_at: trialEnd(-1) }), now)).toContain("storefront up, bookings paused");
    expect(clientAttention(withSub({ trial_ends_at: trialEnd(-5) }), now)).toContain("storefront offline");
    expect(clientState(withSub({ trial_ends_at: trialEnd(-31) }), now)).toBe("expired");
    expect(clientState(withSub({ trial_ends_at: trialEnd(-40), grace_ends_at: trialEnd(3) }), now)).toBe("view_only");
    expect(clientAttention(withSub({ trial_ends_at: trialEnd(-40), grace_ends_at: trialEnd(3) }), now)).toContain("View-only extension until");
    expect(clientState(withSub({ status: "active", trial_ends_at: null, current_period_end: trialEnd(-2) }), now)).toBe("view_only");
  });

  it("puts a waiting payment in front of the operator", () => {
    const paidWithProof = { ...paid, pending_payment: true };
    expect(matchesFilter(paidWithProof, "pending", now)).toBe(true);
    expect(matchesFilter(paidWithProof, "attention", now)).toBe(true);
    expect(matchesFilter(paid, "pending", now)).toBe(false);
    expect(clientAttention(paidWithProof, now)).toMatch(/^Payment waiting for review · Paid until/);
  });
});

describe("ClientsPanel", () => {
  it("opens on businesses that need attention, counts every group, and switches filters", async () => {
    mockFetch(listAndDetail);
    render(<Harness />);
    expect(await screen.findByText("Luna Gowns")).toBeInTheDocument();
    expect(screen.queryByText("Barong Hub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs attention/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Paid/ }));
    expect(screen.getByText("Barong Hub")).toBeInTheDocument();
    expect(screen.queryByText("Luna Gowns")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByPlaceholderText(/Find a business/), { target: { value: "barong" } });
    expect(screen.getByText("Barong Hub")).toBeInTheDocument();
    expect(screen.queryByText("Luna Gowns")).not.toBeInTheDocument();
  });

  it("opens a business from its row and goes back to the list", async () => {
    mockFetch(listAndDetail);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /Luna Gowns/ }));
    expect(await screen.findByText("People with access")).toBeInTheDocument();
    expect(screen.getByText("user_owner_a")).toBeInTheDocument();
    expect(screen.getByText("catalogue.item.created")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All businesses" }));
    expect(await screen.findByRole("button", { name: /Needs attention/ })).toBeInTheDocument();
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
      return listAndDetail(url);
    });
    render(<Harness initial={{ client: tenantId }} />);
    const lockCard = (await screen.findByRole("heading", { name: "Lock business" })).closest("section")!;
    fireEvent.click(screen.getByRole("button", { name: "Lock business", expanded: false }));
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
      return listAndDetail(url);
    });
    render(<Harness initial={{ client: tenantId }} />);
    const trialCard = (await screen.findByRole("heading", { name: "Set trial end" })).closest("section")!;
    fireEvent.click(screen.getByRole("button", { name: "Set trial end", expanded: false }));
    expect(screen.getByRole("button", { name: "Set trial end", expanded: true })).toBeInTheDocument();
    fireEvent.change(trialCard.querySelector("input[type=date]")!, { target: { value: "2026-10-20" } });
    fireEvent.change(trialCard.querySelector("textarea")!, { target: { value: "Pilot extension" } });
    fireEvent.click(trialCard.querySelector("button[type=submit]")!);
    await screen.findByText(/Trial end saved\./);
    expect(sent).toEqual({ trial_ends_at: "2026-10-20T23:59:59+08:00", reason: "Pilot extension" });
  });

  it("opens one action at a time and closes it on cancel", async () => {
    mockFetch(listAndDetail);
    render(<Harness initial={{ client: tenantId }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Record a payment", expanded: false }));
    expect(screen.getByLabelText("Paid until")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set trial end", expanded: false }));
    expect(screen.queryByLabelText("Paid until")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Last trial day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Last trial day")).not.toBeInTheDocument();
  });

  it("lists the owner first among people with access", async () => {
    const staff = { membership_id: "55555555-5555-4555-8555-555555555555", clerk_user_id: "user_front", role: "frontdesk" as const, status: "active" as const, created_at: "2026-09-19T02:00:00Z" };
    mockFetch((url) => url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope({ ...detail, members: [staff, detail.members[0]!] }));
    render(<Harness initial={{ client: tenantId }} />);
    await screen.findByText("People with access");
    const names = [...document.querySelectorAll(".staff-list .row-title")].map((node) => node.textContent);
    expect(names).toEqual(["user_owner_a", "user_front"]);
  });

  it("suspends a staff member with a reason", async () => {
    const paths: string[] = [];
    mockFetch(async (url, init) => {
      if (init.method === "POST") { paths.push(url); return envelope({ tenant: { ...detail, members: [{ ...detail.members[0]!, status: "suspended" }] }, changed: true, replayed: false }); }
      return listAndDetail(url);
    });
    render(<Harness initial={{ client: tenantId }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspend" }));
    fireEvent.change(screen.getByLabelText("Reason", { selector: ".row-form textarea" }), { target: { value: "Left the shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm suspend" }));
    await screen.findByText(/Access suspended\./);
    expect(paths[0]).toContain(`/tenants/${tenantId}/members/${memberId}/suspend`);
  });

  it("lists people across businesses with names and emails, and opens their business", async () => {
    const person = { ...detail.members[0]!, tenant_id: tenantId, tenant_name: "Luna Gowns", tenant_status: "active",
      profile: { email: "maria@luna.ph", name: "Maria Santos", last_sign_in_at: "2026-09-27T01:00:00Z", banned: false, locked: false } };
    const unnamed = { ...person, membership_id: "44444444-4444-4444-8444-444444444444", clerk_user_id: "user_front_desk", role: "frontdesk", profile: null };
    mockFetch((url) => url.endsWith("/people") ? envelope({ items: [person, unnamed] }) : url.endsWith("/tenants") ? envelope({ items: [detail] }) : envelope({ ...detail, members: [person] }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("tab", { name: "People" }));
    expect(await screen.findByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("maria@luna.ph")).toBeInTheDocument();
    expect(screen.getByText("user_front_desk")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Find a person/), { target: { value: "maria" } });
    expect(screen.queryByText("user_front_desk")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Maria Santos, Luna Gowns/ }));
    expect(await screen.findByText("People with access")).toBeInTheDocument();
  });

  it("shows the API failure state when the list cannot load", async () => {
    mockFetch(() => new Response(JSON.stringify({ success: false, request_id: "req_x", error: { code: "DEPENDENCY_UNAVAILABLE", message: "Business administration is not configured." } }), { status: 503 }));
    render(<Harness />);
    expect(await screen.findByText(/could not provide this view/)).toBeInTheDocument();
  });

  it("approves a waiting payment once for a double click, with the reason and an Idempotency-Key", async () => {
    const posts: Array<{ url: string; key: string | null; body: string }> = [];
    const withPayment = { ...detail, pending_payment: true, payments: [pendingPayment] };
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        posts.push({ url, key: new Headers(init.headers).get("Idempotency-Key"), body: String(init.body) });
        return envelope({ tenant: { ...withPayment, pending_payment: false, payments: [{ ...pendingPayment, status: "verified" }] }, changed: true, replayed: false }, "req_approve");
      }
      return url.endsWith("/tenants") ? envelope({ items: [withPayment] }) : envelope(withPayment);
    });
    render(<Harness initial={{ client: tenantId }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText(/What you checked/), { target: { value: "Reference matched in GCash" } });
    const confirm = screen.getByRole("button", { name: "Approve payment" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText(/Payment approved\. The owner is emailed/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain(`/tenants/${tenantId}/subscription-payments/${paymentId}/approve`);
    expect(JSON.parse(posts[0]!.body)).toEqual({ reason: "Reference matched in GCash" });
    expect(posts[0]!.key).toBeTruthy();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("fetches a proof link on demand and shows it as a link that opens in a new tab", async () => {
    const withPayment = { ...detail, payments: [pendingPayment] };
    mockFetch((url) => url.endsWith("/proof-link")
      ? envelope({ url: "https://api.example/api/v1/operator/payment-proofs/p1.token", expires_at: "2026-10-01T02:05:00Z" })
      : url.endsWith("/tenants") ? envelope({ items: [withPayment] }) : envelope(withPayment));
    render(<Harness initial={{ client: tenantId }} />);
    fireEvent.click(await screen.findByRole("button", { name: "View proof" }));
    const link = await screen.findByRole("link", { name: /Open proof/ });
    expect(link).toHaveAttribute("href", "https://api.example/api/v1/operator/payment-proofs/p1.token");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("adds an operator note and extends view-only access to the end of a Manila day", async () => {
    const lapsed = { ...detail, subscription: { ...detail.subscription!, trial_ends_at: inDays(-2), current_period_end: inDays(-2) } };
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      if (init.method === "POST") {
        sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        const notes = url.endsWith("/notes") ? [{ id: "n1", body: "Paying Friday", author_label: "ops@drezivo.shop", created_at: "2026-10-01T03:00:00Z" }] : [];
        return envelope({ tenant: { ...lapsed, notes }, changed: true, replayed: false });
      }
      return url.endsWith("/tenants") ? envelope({ items: [lapsed] }) : envelope(lapsed);
    });
    render(<Harness initial={{ client: tenantId }} />);
    fireEvent.change(await screen.findByPlaceholderText("Add a note"), { target: { value: "  Paying Friday " } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Paying Friday")).toBeInTheDocument();
    expect(sent[0]).toEqual({ url: expect.stringContaining(`/tenants/${tenantId}/notes`), body: { body: "Paying Friday" } });

    const card = (await screen.findByRole("heading", { name: "Extend view-only access" })).closest("section")!;
    fireEvent.click(screen.getByRole("button", { name: "Extend view-only access", expanded: false }));
    fireEvent.change(card.querySelector("input[type=date]")!, { target: { value: "2026-10-20" } });
    fireEvent.change(card.querySelector("textarea")!, { target: { value: "Owner paying Friday" } });
    fireEvent.click(card.querySelector("button[type=submit]")!);
    await screen.findByText(/View-only access extended\./);
    expect(sent[1]).toEqual({ url: expect.stringContaining("/read-only-extension"), body: { read_only_until: "2026-10-20T23:59:59+08:00", reason: "Owner paying Friday" } });
  });
});
