"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { useCachedLoad } from "@/shared/api/view-cache";
import { MutationGuard } from "@/shared/api/mutations";
import { paymentPaths } from "@/features/payments/api";
import { type SubscriptionPayment } from "@/features/payments/model";
import { type ClientCommandResult } from "@/features/clients/model";
import { formatManila, formatPeso } from "@/shared/lib/format";
import { getTokenWithTimeout } from "@/shared/auth/token";
import { BusinessSelect } from "@/features/clients/components/BusinessSelect";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { ProofLightbox } from "./ProofLightbox";

type Decision = "approve" | "reject";
type Token = () => Promise<string>;

const statusLabel: Record<SubscriptionPayment["status"], string> = { pending: "Waiting for review", verified: "Approved", failed: "Rejected" };
const statusTone: Record<SubscriptionPayment["status"], string> = { pending: "pending", verified: "active", failed: "rejected" };

/**
 * Proofs of subscription payment, with the review actions. One review runs at a time, and a retry
 * of the same decision reuses its idempotency key. Approving gives the business one more paid month;
 * the reject reason is shown to the owner, so it is written for them.
 */
export function PaymentReviewList({ payments, token, showBusiness = false, onReviewed, onOpenBusiness }: {
  payments: SubscriptionPayment[];
  token: Token;
  showBusiness?: boolean;
  onReviewed: (result: ClientCommandResult, requestId: string, decision: Decision) => void;
  onOpenBusiness?: (tenantId: string) => void;
}) {
  const guard = useRef(new MutationGuard());
  const [pending, setPending] = useState<string | null>(null);
  const [open, setOpen] = useState<{ paymentId: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [proof, setProof] = useState<{ tenantId: string; paymentId: string } | null>(null);

  async function review(payment: SubscriptionPayment, decision: Decision) {
    const text = reason.trim();
    if (guard.current.isPending || (decision === "reject" && text.length < 3) || (text.length > 0 && text.length < 3)) return;
    const intent = `payment:${payment.payment_id}:${decision}`;
    const path = paymentPaths.reviewPayment(payment.tenant_id, payment.payment_id, decision);
    setError(null);
    setPending(intent);
    try {
      const body = text ? { reason: text } : {};
      const result = await guard.current.run(intent, { path, body }, async (idempotencyKey) =>
        apiRequest<ClientCommandResult>(path, { method: "POST", token: await token(), body, idempotencyKey }));
      if (!result) return;
      setOpen(null);
      setReason("");
      onReviewed(result.data, result.requestId, decision);
    } catch (reviewError) {
      setError(reviewError instanceof ApiError ? reviewError : new ApiError("An unexpected error occurred.", "http"));
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  return <>
    {proof && <ProofLightbox tenantId={proof.tenantId} paymentId={proof.paymentId} token={token} onClose={() => setProof(null)} />}
    {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}
    <ul className="data-list payment-list" aria-label="Payments">
      <li className="data-list-head" aria-hidden="true">{showBusiness && <span>Business</span>}<span>Amount</span><span>Method</span><span>Reference</span><span>Sent</span><span>Status</span><span /></li>
      {payments.map((payment) => {
        const reviewing = open?.paymentId === payment.payment_id ? open.decision : null;
        return <li key={payment.payment_id} className="data-row">
          <dl className="row-fields">
            {showBusiness && <div><dt>Business</dt><dd>{onOpenBusiness
              ? <button type="button" className="text-button inline-link" onClick={() => onOpenBusiness(payment.tenant_id)}>{payment.tenant_name}</button>
              : payment.tenant_name}</dd></div>}
            <div><dt>Amount</dt><dd>{formatPeso(payment.amount_minor, payment.currency)}{payment.target_plan_code && <span className="row-sub">Requested {payment.target_plan_code.charAt(0).toUpperCase()+payment.target_plan_code.slice(1)}</span>}</dd></div>
            <div><dt>Method</dt><dd>{payment.method_label ?? "—"}</dd></div>
            <div><dt>Reference</dt><dd className="mono">{payment.reference ?? "—"}</dd></div>
            <div><dt>Sent</dt><dd>{formatManila(payment.submitted_at, true)}</dd></div>
            <div className="field-status"><dt>Status</dt><dd><StatusBadge value={statusTone[payment.status]} label={statusLabel[payment.status]} /></dd></div>
            {payment.review_note && <div className="fact-wide"><dt>Reason given</dt><dd>{payment.review_note}</dd></div>}
          </dl>
          <div className="row-actions payment-actions">
            {payment.has_proof && <button type="button" className="table-action" onClick={() => setProof({ tenantId: payment.tenant_id, paymentId: payment.payment_id })}>View proof</button>}
            {payment.status === "pending" && !reviewing && <>
              <button type="button" className="table-action" disabled={busy} onClick={() => { setOpen({ paymentId: payment.payment_id, decision: "approve" }); setReason(""); }}>Approve</button>
              <button type="button" className="table-action" disabled={busy} onClick={() => { setOpen({ paymentId: payment.payment_id, decision: "reject" }); setReason(""); }}>Reject</button>
            </>}
          </div>
          {reviewing && <form className="row-form" onSubmit={(event) => { event.preventDefault(); void review(payment, reviewing); }}>
            <label>{reviewing === "approve" ? "What you checked (optional)" : "Reason for the owner"}
              <span className="field-hint">{reviewing === "approve" ? "Saved in the activity log when provided." : "The owner sees this in the app; an email notification is queued."}</span>
              <textarea required={reviewing === "reject"} minLength={reviewing === "reject" ? 3 : undefined} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} autoFocus />
            </label>
            <span>
              <button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(null); setReason(""); }}>Cancel</button>
              <button className={`button ${reviewing === "reject" ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || (reviewing === "reject" && reason.trim().length < 3) || (reason.trim().length > 0 && reason.trim().length < 3)}>
                {busy ? "Saving…" : reviewing === "approve" ? "Approve payment" : "Reject payment"}
              </button>
            </span>
          </form>}
        </li>;
      })}
    </ul>
  </>;
}

/** Every payment one business has sent, newest first, with the same review actions as the queue. */
function BusinessPaymentHistory({ tenantId, token, onOpenBusiness }: { tenantId: string; token: (signal?: AbortSignal) => Promise<string>; onOpenBusiness: (tenantId: string) => void }) {
  const [state, load] = useCachedLoad<{ items: SubscriptionPayment[] }>(paymentPaths.tenantPayments(tenantId), token);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);
  if (state.status === "error") return <StatePanel error={state.error} dependency="Business API" onRetry={() => void load()} />;
  if (state.status === "loading") return <LoadingPanel />;
  const payments = state.data.items;
  const approved = payments.filter((payment) => payment.status === "verified");
  const approvedMinor = approved.reduce((sum, payment) => sum + Number(payment.amount_minor), 0);
  return <>
    {notice && <p className="action-success" role="status">{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {payments.length === 0 ? <EmptyPanel title="No payments yet" body="This business has not sent a payment." />
      : <>
        <p className="muted" role="status">{payments.length} payment{payments.length === 1 ? "" : "s"} · {approved.length} approved, {formatPeso(String(approvedMinor), approved[0]?.currency ?? "PHP")} in total</p>
        <PaymentReviewList payments={payments} token={token}
          onReviewed={(result, requestId, decision) => {
            setNotice({ message: `${decision === "approve" ? "Payment approved" : "Payment rejected"} for ${result.tenant.name}. An owner notification is queued.`, requestId });
            void load();
          }} />
        <p className="muted clients-footnote">
          <button type="button" className="text-button inline-link" onClick={() => onOpenBusiness(tenantId)}>Open this business</button> · Dates in Manila time <RequestId requestId={state.requestId} />
        </p>
      </>}
  </>;
}

/** The pending queue or the recently reviewed payments across every business. */
function PaymentQueue({ view, token, onOpenBusiness }: { view: "pending" | "recent"; token: (signal?: AbortSignal) => Promise<string>; onOpenBusiness: (tenantId: string) => void }) {
  const [state, load] = useCachedLoad<{ items: SubscriptionPayment[] }>(paymentPaths.payments(view), token);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);
  return <>
    {notice && <p className="action-success" role="status">{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {state.status === "error" ? <StatePanel error={state.error} dependency="Business API" onRetry={() => void load()} />
      : state.status === "loading" ? <LoadingPanel />
        : state.data.items.length === 0 ? <EmptyPanel title={view === "pending" ? "Nothing to review" : "No payments yet"} body={view === "pending" ? "Proofs of payment appear here when an owner sends one." : "Reviewed and waiting payments appear here."} />
          : <PaymentReviewList payments={state.data.items} token={token} showBusiness onOpenBusiness={onOpenBusiness}
            onReviewed={(result, requestId, decision) => {
              setNotice({ message: `${decision === "approve" ? "Payment approved" : "Payment rejected"} for ${result.tenant.name}. An owner notification is queued.`, requestId });
              void load();
            }} />}
    {state.status === "ready" && <p className="muted clients-footnote">Amounts are set by the server from the plan price · Dates in Manila time <RequestId requestId={state.requestId} /></p>}
  </>;
}

/** The pending queue, recently reviewed payments, and one business's whole history. */
export function PaymentsPanel({ getToken, onOpenBusiness }: { getToken: () => Promise<string | null>; onOpenBusiness: (tenantId: string) => void }) {
  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);
  const [view, setView] = useState<"pending" | "recent" | "business">("pending");
  const [tenantId, setTenantId] = useState("");

  return <div className="clients payments">
    <div className="segmented" role="tablist" aria-label="Show">
      {(["pending", "recent", "business"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
        {id === "pending" ? "Waiting for review" : id === "recent" ? "Recently sent" : "By business"}
      </button>)}
    </div>
    {view === "business" ? <>
      <BusinessSelect token={token} value={tenantId} onChange={setTenantId} label="Business" />
      {tenantId ? <BusinessPaymentHistory key={tenantId} tenantId={tenantId} token={token} onOpenBusiness={onOpenBusiness} />
        : <EmptyPanel title="Choose a business" body="Pick a business to see every payment it has sent." />}
    </> : <PaymentQueue key={view} view={view} token={token} onOpenBusiness={onOpenBusiness} />}
  </div>;
}
