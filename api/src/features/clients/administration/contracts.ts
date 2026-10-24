import { z } from "zod";
import { AppError } from "../../../shared/http/errors.js";
import type { BusinessUserProfile } from "../repository/clerk-directory.js";

/**
 * Client administration for Drezivo's client businesses: list and view businesses and their staff, and run
 * the few lifecycle actions an operator needs before the business API exposes operator commands
 * (ADR 0025). Every mutation is keyed by an Idempotency-Key so a retry replays instead of acting twice.
 */

export const uuid = z.string().uuid();
export const idempotencyKey = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
export const reason = z.string().trim().min(3).max(500).regex(/^[^\u0000-\u001f\u007f]*$/);
const isoDate = z.string().datetime({ offset: true });
const businessName = z.string().trim().min(2).max(120).regex(/^[^\u0000-\u001f\u007f]*$/);
const timezone = z.string().trim().min(3).max(64).refine((value) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}, 'Unknown IANA time zone.');

export const tenantStatusSchema = z.enum(['active', 'restricted', 'cancelled']);
export const subscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'restricted', 'cancelled']);
export const membershipStatusSchema = z.enum(['active', 'suspended', 'removed']);

export type TenantSummary = {
  tenant_id: string;
  name: string;
  slug: string;
  status: z.infer<typeof tenantStatusSchema>;
  timezone: string;
  created_at: string;
  subscription: {
    status: z.infer<typeof subscriptionStatusSchema>;
    plan_code: string;
    trial_ends_at: string | null;
    grace_ends_at: string | null;
    current_period_end: string | null;
  } | null;
  member_counts: { active: number; suspended: number; removed: number };
  /** A subscription payment proof is waiting for review. */
  pending_payment: boolean;
};

export const subscriptionPaymentStatusSchema = z.enum(['pending', 'verified', 'failed']);

/** One proof of payment a business sent for its Drezivo subscription. */
export type SubscriptionPaymentRow = {
  payment_id: string;
  tenant_id: string;
  tenant_name: string;
  status: z.infer<typeof subscriptionPaymentStatusSchema>;
  amount_minor: string;
  currency: string;
  reference: string | null;
  method_label: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  has_proof: boolean;
  target_plan_code?: string | null;
};

/** Operator-only note on a business (append-only; businesses never see these). */
export type TenantNote = { id: string; body: string; author_label: string; created_at: string };

export type TenantMember = {
  membership_id: string;
  clerk_user_id: string;
  role: 'owner' | 'frontdesk';
  status: z.infer<typeof membershipStatusSchema>;
  created_at: string;
  /** Name/email from the business Clerk instance; null when unknown or the directory is not configured. */
  profile?: BusinessUserProfile | null;
};

export type PersonRow = Omit<TenantMember, 'profile'> & { tenant_id: string; tenant_name: string; tenant_status: z.infer<typeof tenantStatusSchema> };

export type TenantAuditEntry = {
  occurred_at: string;
  actor_kind: string;
  action: string;
  entity_type: string;
  outcome: string;
};

export type TenantDetail = TenantSummary & {
  members: TenantMember[];
  recent_audit: TenantAuditEntry[];
  notes: TenantNote[];
  payments: SubscriptionPaymentRow[];
};

export type CommandContext = { operatorSubject: string; idempotencyKey: string; requestId: string; reason: string; requestFingerprint?: string };
export type CommandResult = { tenant: TenantDetail; changed: boolean; replayed: boolean };

export const profileInputSchema = z.object({ name: businessName.optional(), timezone: timezone.optional(), reason }).strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined, 'Provide a name or a timezone to change.');
export const reasonInputSchema = z.object({ reason }).strict();
export const trialInputSchema = z.object({ trial_ends_at: isoDate, reason }).strict();
export const activateInputSchema = z.object({ current_period_end: isoDate, reason }).strict();
export const readOnlyExtensionInputSchema = z.object({ read_only_until: isoDate, reason }).strict();
export const noteInputSchema = z.object({ body: z.string().trim().min(1).max(2000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/) }).strict();
export const paymentQueueQuerySchema = z.object({ status: z.enum(['pending', 'recent']).default('pending') }).strict();

export type TenantAdminPort = {
  listTenants(): Promise<TenantSummary[]>;
  listPeople(): Promise<PersonRow[]>;
  getTenant(tenantId: string): Promise<TenantDetail | null>;
  updateProfile(tenantId: string, change: { name?: string; timezone?: string }, context: CommandContext): Promise<CommandResult>;
  setTenantLocked(tenantId: string, locked: boolean, context: CommandContext): Promise<CommandResult>;
  setMemberSuspended(tenantId: string, membershipId: string, suspended: boolean, context: CommandContext): Promise<CommandResult>;
  setTrialEnd(tenantId: string, trialEndsAt: Date, context: CommandContext): Promise<CommandResult>;
  activateSubscription(tenantId: string, currentPeriodEnd: Date, context: CommandContext): Promise<CommandResult>;
  /** Pilot billing: view-only access (storefront visible, no bookings) until the given date. */
  extendReadOnly(tenantId: string, readOnlyUntil: Date, context: CommandContext): Promise<CommandResult>;
  addNote(tenantId: string, body: string, authorLabel: string, context: CommandContext): Promise<CommandResult>;
  listPayments(filter: 'pending' | 'recent'): Promise<SubscriptionPaymentRow[]>;
  /** Approve: payment verified, one more paid month, owner emailed. Reject: reason shown to the owner. */
  reviewPayment(tenantId: string, paymentId: string, decision: 'approve' | 'reject', context: CommandContext): Promise<CommandResult>;
};

/** Signs 5-minute links to a payment's proof on the business API; absent when not configured. */
export type ProofLinkSigner = (tenantId: string, paymentId: string) => { url: string; expires_at: string } | null;

export const unavailable = () => new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Business administration is not configured.');
export const unavailableTenantAdminPort: TenantAdminPort = {
  listTenants: async () => { throw unavailable(); },
  listPeople: async () => { throw unavailable(); },
  getTenant: async () => { throw unavailable(); },
  updateProfile: async () => { throw unavailable(); },
  setTenantLocked: async () => { throw unavailable(); },
  setMemberSuspended: async () => { throw unavailable(); },
  setTrialEnd: async () => { throw unavailable(); },
  activateSubscription: async () => { throw unavailable(); },
  extendReadOnly: async () => { throw unavailable(); },
  addNote: async () => { throw unavailable(); },
  listPayments: async () => { throw unavailable(); },
  reviewPayment: async () => { throw unavailable(); },
};

export { tenantAdminPermissions } from "../../../shared/auth/operator-permission-codes.js";
