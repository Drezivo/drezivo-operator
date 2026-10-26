export type SubscriptionSummary = {
  tenant_id: string;
  business_name: string;
  plan_code: string;
  status: string;
  currency: string;
  current_period_end: string | null;
  trial_ends_at?: string | null;
  grace_ends_at?: string | null;
  amount_minor?: string;
  paid_at?: string | null;
  reviewed_by?: string | null;
  payer_key?: string | null;
  paid_amount_minor?: string | null;
  payment_status?: string | null;
};

export type SubscriptionPage = { items: SubscriptionSummary[]; next_cursor?: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isSubscriptionSummary(value: unknown): value is SubscriptionSummary {
  if (!isRecord(value)) return false;
  return typeof value.tenant_id === "string"
    && typeof value.business_name === "string"
    && typeof value.plan_code === "string"
    && typeof value.status === "string"
    && typeof value.currency === "string"
    && /^[A-Z]{3}$/.test(value.currency)
    && (value.current_period_end === null || typeof value.current_period_end === "string")
    && isOptionalNullableString(value.trial_ends_at)
    && isOptionalNullableString(value.grace_ends_at)
    && isOptionalString(value.amount_minor)
    && isOptionalNullableString(value.paid_at)
    && isOptionalNullableString(value.reviewed_by)
    && isOptionalNullableString(value.payer_key)
    && isOptionalNullableString(value.paid_amount_minor)
    && isOptionalNullableString(value.payment_status);
}

/** Runtime guard for the subscriptions page before the view renders its rows. */
export function isSubscriptionPage(value: unknown): value is SubscriptionPage {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return (value.next_cursor === undefined || value.next_cursor === null || typeof value.next_cursor === "string")
    && value.items.every(isSubscriptionSummary);
}
