/** Contract for the Operator API business-administration routes (`/api/v1/tenants*`, ADR 0025). */

export type ClientStatus = "active" | "restricted" | "cancelled";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "restricted" | "cancelled";
export type MemberStatus = "active" | "suspended" | "removed";

export type ClientSummary = {
  tenant_id: string;
  name: string;
  slug: string;
  status: ClientStatus;
  timezone: string;
  created_at: string;
  subscription: {
    status: SubscriptionStatus;
    plan_code: string;
    trial_ends_at: string | null;
    grace_ends_at: string | null;
    current_period_end: string;
  } | null;
  member_counts: { active: number; suspended: number; removed: number };
  /** A proof of subscription payment is waiting for review. */
  pending_payment: boolean;
};

export type StaffProfile = { email: string | null; name: string | null; last_sign_in_at: string | null; banned: boolean; locked: boolean };
export type ClientMember = { membership_id: string; clerk_user_id: string; role: "owner" | "frontdesk"; status: MemberStatus; created_at: string; profile?: StaffProfile | null };
export type PersonRow = ClientMember & { tenant_id: string; tenant_name: string; tenant_status: ClientStatus };

/** Best human label for a staff member: name, then email, then the Clerk user ID. */
export function personLabel(member: ClientMember): { primary: string; secondary: string | null } {
  const name = member.profile?.name ?? null;
  const email = member.profile?.email ?? null;
  if (name) return { primary: name, secondary: email };
  if (email) return { primary: email, secondary: null };
  return { primary: member.clerk_user_id, secondary: null };
}
export type ClientAuditEntry = { occurred_at: string; actor_kind: string; action: string; entity_type: string; outcome: string };
export type PaymentStatus = "pending" | "verified" | "failed";
/** One proof of payment a business sent for its Standard subscription. */
export type SubscriptionPayment = {
  payment_id: string; tenant_id: string; tenant_name: string; status: PaymentStatus;
  amount_minor: string; currency: string; reference: string | null; method_label: string | null;
  submitted_at: string; reviewed_at: string | null; reviewed_by: string | null; review_note: string | null; has_proof: boolean;
};
/** Operator-only note; businesses never see these. */
export type ClientNote = { id: string; body: string; author_label: string; created_at: string };
export type ClientDetail = ClientSummary & { members: ClientMember[]; recent_audit: ClientAuditEntry[]; notes: ClientNote[]; payments: SubscriptionPayment[] };
export type ClientCommandResult = { tenant: ClientDetail; changed: boolean; replayed: boolean };

export const OPERATOR_TIME_ZONE = "Asia/Manila";

export const clientPaths = {
  list: "/tenants",
  people: "/people",
  detail: (id: string) => `/tenants/${encodeURIComponent(id)}`,
  profile: (id: string) => `/tenants/${encodeURIComponent(id)}/profile`,
  lock: (id: string) => `/tenants/${encodeURIComponent(id)}/lock`,
  unlock: (id: string) => `/tenants/${encodeURIComponent(id)}/unlock`,
  trial: (id: string) => `/tenants/${encodeURIComponent(id)}/trial`,
  activate: (id: string) => `/tenants/${encodeURIComponent(id)}/activate`,
  readOnlyExtension: (id: string) => `/tenants/${encodeURIComponent(id)}/read-only-extension`,
  notes: (id: string) => `/tenants/${encodeURIComponent(id)}/notes`,
  payments: (status: "pending" | "recent") => `/subscription-payments?status=${status}`,
  reviewPayment: (id: string, paymentId: string, decision: "approve" | "reject") =>
    `/tenants/${encodeURIComponent(id)}/subscription-payments/${encodeURIComponent(paymentId)}/${decision}`,
  proofLink: (id: string, paymentId: string) =>
    `/tenants/${encodeURIComponent(id)}/subscription-payments/${encodeURIComponent(paymentId)}/proof-link`,
  member: (id: string, membershipId: string, action: "suspend" | "reactivate") =>
    `/tenants/${encodeURIComponent(id)}/members/${encodeURIComponent(membershipId)}/${action}`,
} as const;

const dateTime = new Intl.DateTimeFormat("en-PH", { timeZone: OPERATOR_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-PH", { timeZone: OPERATOR_TIME_ZONE, dateStyle: "medium" });

/** Formats an instant in Manila time; every date on this screen uses the same zone. */
export function formatManila(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return (withTime ? dateTime : dateOnly).format(date);
}

/** A `<input type="date">` value (YYYY-MM-DD) means "until the end of that day in Manila". */
export function endOfManilaDay(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const iso = `${dateInput}T23:59:59+08:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** YYYY-MM-DD for the Manila calendar day `days` after `from`. */
export function manilaDateInput(from: Date, days: number): string {
  const shifted = new Date(from.getTime() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: OPERATOR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
  return parts;
}

/** Days left until an instant, rounded up; negative once it has passed. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - now.getTime()) / 86_400_000);
}

/** Pilot billing timings; the business API is authoritative (api/src/modules/billing/access.ts). */
export const READ_ONLY_DAYS = 30;
export const STOREFRONT_GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * A single status per business, in the words an operator uses. Mirrors the business API's access
 * rules: full access until the trial or paid-through end, then view-only for 30 days (or until an
 * operator extension), then expired (only Subscribe works).
 */
export type ClientState = "locked" | "cancelled" | "restricted" | "unpaid" | "trial" | "paid" | "view_only" | "expired" | "no_subscription";

/** The instant access depends on: the trial end while trialing, otherwise the paid-through date. */
export function accessEnd(subscription: NonNullable<ClientSummary["subscription"]>): string {
  return subscription.status === "trialing" ? subscription.trial_ends_at ?? subscription.current_period_end : subscription.current_period_end;
}

export function clientState(client: ClientSummary, now: Date = new Date()): ClientState {
  if (client.status === "cancelled" || client.subscription?.status === "cancelled") return "cancelled";
  if (client.status === "restricted" && client.subscription?.status !== "restricted") return "locked";
  const subscription = client.subscription;
  if (!subscription) return "no_subscription";
  // Pre-pilot lifecycle states. Business migration 0063 moved these rows; keep them readable.
  if (subscription.status === "restricted") return "restricted";
  if (subscription.status === "past_due") return "unpaid";
  const end = new Date(accessEnd(subscription)).getTime();
  const nowMs = now.getTime();
  if (nowMs < end) return subscription.status === "trialing" ? "trial" : "paid";
  const extension = subscription.grace_ends_at ? new Date(subscription.grace_ends_at).getTime() : null;
  if (extension !== null && extension > nowMs) return "view_only";
  return nowMs < end + READ_ONLY_DAYS * DAY_MS ? "view_only" : "expired";
}

export const clientStateLabel: Record<ClientState, string> = {
  locked: "Locked", cancelled: "Cancelled", restricted: "Restricted", unpaid: "Unpaid", trial: "Trial", paid: "Paid",
  view_only: "View-only", expired: "Expired", no_subscription: "No subscription",
};

/** StatusBadge tone keys for each state (see StatusBadge's status sets). */
export const clientStateTone: Record<ClientState, string> = {
  locked: "restricted", cancelled: "cancelled", restricted: "restricted", unpaid: "past_due", trial: "trialing", paid: "active",
  view_only: "past_due", expired: "expired", no_subscription: "unknown",
};

export type ClientFilter = "attention" | "pending" | "trial" | "unpaid" | "locked" | "paid" | "all";
export const CLIENT_FILTERS: readonly ClientFilter[] = ["attention", "pending", "trial", "unpaid", "locked", "paid", "all"];
export const TRIAL_ENDING_DAYS = 3;

/** A business needs attention when an operator is likely to act on it today. */
export function needsAttention(client: ClientSummary, now: Date = new Date()): boolean {
  if (client.pending_payment) return true;
  const state = clientState(client, now);
  if (state === "trial" || state === "paid") {
    const left = client.subscription ? daysUntil(accessEnd(client.subscription), now) : null;
    return left !== null && left <= TRIAL_ENDING_DAYS;
  }
  return state !== "cancelled";
}

export function matchesFilter(client: ClientSummary, filter: ClientFilter, now: Date = new Date()): boolean {
  const state = clientState(client, now);
  switch (filter) {
    case "attention": return needsAttention(client, now);
    case "pending": return client.pending_payment;
    case "trial": return state === "trial";
    case "unpaid": return state === "view_only" || state === "expired" || state === "unpaid" || state === "restricted";
    case "locked": return state === "locked";
    case "paid": return state === "paid";
    default: return true;
  }
}

/** One plain sentence describing what an operator should know about a client right now. */
export function clientAttention(client: ClientSummary, now: Date = new Date()): string {
  const text = accessSentence(client, now);
  return client.pending_payment ? `Payment waiting for review · ${text}` : text;
}

function accessSentence(client: ClientSummary, now: Date): string {
  const state = clientState(client, now);
  const subscription = client.subscription;
  switch (state) {
    case "cancelled": return "Cancelled";
    case "locked": return "Locked by an operator";
    case "no_subscription": return "No subscription record";
    case "restricted": return "Trial or grace period ended — staff cannot make changes";
    case "unpaid": return `Unpaid — grace ends ${formatManila(subscription?.grace_ends_at)}`;
    default: break;
  }
  if (!subscription) return "No subscription record";
  const end = accessEnd(subscription);
  const left = daysUntil(end, now);
  if (state === "trial") return left === null ? "Trial" : left <= 0 ? "Trial ends today" : `Trial: ${left} day${left === 1 ? "" : "s"} left`;
  if (state === "paid") return left !== null && left <= TRIAL_ENDING_DAYS ? `Paid until ${formatManila(end)} — renewal due` : `Paid until ${formatManila(end)}`;
  const extension = subscription.grace_ends_at && new Date(subscription.grace_ends_at).getTime() > now.getTime() ? subscription.grace_ends_at : null;
  if (state === "view_only") {
    if (extension) return `View-only extension until ${formatManila(extension)}`;
    const endMs = new Date(end).getTime();
    const storefrontUp = now.getTime() < endMs + STOREFRONT_GRACE_DAYS * DAY_MS;
    const until = new Date(endMs + READ_ONLY_DAYS * DAY_MS).toISOString();
    return `View-only until ${formatManila(until)} · storefront ${storefrontUp ? "up, bookings paused" : "offline"}`;
  }
  return "Expired — only Subscribe works until a payment is approved";
}

/** A peso amount from minor units, for display only. */
export function formatPeso(amountMinor: string, currency = "PHP"): string {
  const value = Number(amountMinor) / 100;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
}
