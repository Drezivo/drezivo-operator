export type PaymentStatus = "pending" | "verified" | "failed";
/** One proof of subscription payment, including a requested Free-plan upgrade. */
export type SubscriptionPayment = {
  payment_id: string; tenant_id: string; tenant_name: string; status: PaymentStatus;
  amount_minor: string; currency: string; reference: string | null; method_label: string | null;
  submitted_at: string; reviewed_at: string | null; reviewed_by: string | null; review_note: string | null; has_proof: boolean;
  target_plan_code?: string | null;
};
