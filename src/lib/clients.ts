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
};

export type ClientMember = { membership_id: string; clerk_user_id: string; role: "owner" | "frontdesk"; status: MemberStatus; created_at: string };
export type ClientAuditEntry = { occurred_at: string; actor_kind: string; action: string; entity_type: string; outcome: string };
export type ClientDetail = ClientSummary & { members: ClientMember[]; recent_audit: ClientAuditEntry[] };
export type ClientCommandResult = { tenant: ClientDetail; changed: boolean; replayed: boolean };

export const OPERATOR_TIME_ZONE = "Asia/Manila";

export const clientPaths = {
  list: "/tenants",
  detail: (id: string) => `/tenants/${encodeURIComponent(id)}`,
  profile: (id: string) => `/tenants/${encodeURIComponent(id)}/profile`,
  lock: (id: string) => `/tenants/${encodeURIComponent(id)}/lock`,
  unlock: (id: string) => `/tenants/${encodeURIComponent(id)}/unlock`,
  trial: (id: string) => `/tenants/${encodeURIComponent(id)}/trial`,
  activate: (id: string) => `/tenants/${encodeURIComponent(id)}/activate`,
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

/** One plain sentence describing what an operator should know about a client right now. */
export function clientAttention(client: ClientSummary, now: Date = new Date()): string {
  if (client.status === "cancelled") return "Cancelled";
  if (client.status === "restricted" && client.subscription?.status !== "restricted") return "Locked by an operator";
  const subscription = client.subscription;
  if (!subscription) return "No subscription record";
  if (subscription.status === "restricted") return "Trial or grace period ended — staff cannot make changes";
  if (subscription.status === "past_due") return `Unpaid — grace ends ${formatManila(subscription.grace_ends_at)}`;
  if (subscription.status === "trialing") {
    const left = daysUntil(subscription.trial_ends_at, now);
    return left === null ? "Trial" : left <= 0 ? "Trial ends today" : `Trial: ${left} day${left === 1 ? "" : "s"} left`;
  }
  if (subscription.status === "active") return `Paid until ${formatManila(subscription.current_period_end)}`;
  return subscription.status;
}
