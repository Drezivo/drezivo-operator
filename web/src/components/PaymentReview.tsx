"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowSquareOut, CircleNotch } from "@phosphor-icons/react";
import { ApiError, apiRequest } from "@/lib/api";
import { useCachedLoad } from "@/lib/view-cache";
import { MutationGuard } from "@/lib/mutations";
import { clientPaths, formatManila, formatPeso, type ClientCommandResult, type SubscriptionPayment } from "@/lib/clients";
import { getTokenWithTimeout } from "@/lib/token";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { StatusBadge } from "./StatusBadge";

type Decision = "approve" | "reject";
type Token = () => Promise<string>;
type ProofLink = { paymentId: string; url: string; expiresAt: string };

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
  const [proof, setProof] = useState<ProofLink | null>(null);
  const [proofLoading, setProofLoading] = useState<string | null>(null);

  async function review(payment: SubscriptionPayment, decision: Decision) {
    const text = reason.trim();
    if (guard.current.isPending || text.length < 3) return;
    const intent = `payment:${payment.payment_id}:${decision}`;
    const path = clientPaths.reviewPayment(payment.tenant_id, payment.payment_id, decision);
    setError(null);
    setPending(intent);
    try {
      const result = await guard.current.run(intent, { path, reason: text }, async (idempotencyKey) =>
        apiRequest<ClientCommandResult>(path, { method: "POST", token: await token(), body: { reason: text }, idempotencyKey }));
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

  /** Links live 5 minutes, so one is fetched on demand and shown as a plain link to open. */
  async function loadProof(payment: SubscriptionPayment) {
    if (proofLoading) return;
    setError(null);
    setProofLoading(payment.payment_id);
    try {
      const result = await apiRequest<{ url: string; expires_at: string }>(clientPaths.proofLink(payment.tenant_id, payment.payment_id), { token: await token() });
      setProof({ paymentId: payment.payment_id, url: result.data.url, expiresAt: result.data.expires_at });
    } catch (proofError) {
      setError(proofError instanceof ApiError ? proofError : new ApiError("An unexpected error occurred.", "http"));
    } finally {
      setProofLoading(null);
    }
  }

  const busy = pending !== null;
  return <>
    {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}
    <ul className="data-list payment-list" aria-label="Payments">
      <li className="data-list-head" aria-hidden="true">{showBusiness && <span>Business</span>}<span>Amount</span><span>Method</span><span>Reference</span><span>Sent</span><span>Status</span><span /></li>
      {payments.map((payment) => {
        const reviewing = open?.paymentId === payment.payment_id ? open.decision : null;
        const link = proof?.paymentId === payment.payment_id ? proof : null;
        return <li key={payment.payment_id} className="data-row">
          <dl className="row-fields">
            {showBusiness && <div><dt>Business</dt><dd>{onOpenBusiness
              ? <button type="button" className="text-button inline-link" onClick={() => onOpenBusiness(payment.tenant_id)}>{payment.tenant_name}</button>
              : payment.tenant_name}</dd></div>}
            <div><dt>Amount</dt><dd>{formatPeso(payment.amount_minor, payment.currency)}</dd></div>
            <div><dt>Method</dt><dd>{payment.method_label ?? "—"}</dd></div>
            <div><dt>Reference</dt><dd className="mono">{payment.reference ?? "—"}</dd></div>
            <div><dt>Sent</dt><dd>{formatManila(payment.submitted_at, true)}</dd></div>
            <div className="field-status"><dt>Status</dt><dd><StatusBadge value={statusTone[payment.status]} label={statusLabel[payment.status]} /></dd></div>
            {payment.review_note && <div className="fact-wide"><dt>Reason given</dt><dd>{payment.review_note}</dd></div>}
          </dl>
          <div className="row-actions payment-actions">
            {payment.has_proof && (link
              ? <a className="table-action" href={link.url} target="_blank" rel="noopener noreferrer">Open proof <ArrowSquareOut size={13} aria-hidden="true" /></a>
              : <button type="button" className="table-action" disabled={proofLoading !== null} onClick={() => void loadProof(payment)}>
                {proofLoading === payment.payment_id ? <><CircleNotch className="spin" size={13} /> Loading…</> : "View proof"}
              </button>)}
            {payment.status === "pending" && !reviewing && <>
              <button type="button" className="table-action" disabled={busy} onClick={() => { setOpen({ paymentId: payment.payment_id, decision: "approve" }); setReason(""); }}>Approve</button>
              <button type="button" className="table-action" disabled={busy} onClick={() => { setOpen({ paymentId: payment.payment_id, decision: "reject" }); setReason(""); }}>Reject</button>
            </>}
          </div>
          {reviewing && <form className="row-form" onSubmit={(event) => { event.preventDefault(); void review(payment, reviewing); }}>
            <label>{reviewing === "approve" ? "What you checked" : "Reason for the owner"}
              <span className="field-hint">{reviewing === "approve" ? "For example: reference matched in GCash. Saved in the activity log." : "The owner sees this in the app and by email."}</span>
              <textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} autoFocus />
            </label>
            <span>
              <button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(null); setReason(""); }}>Cancel</button>
              <button className={`button ${reviewing === "reject" ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || reason.trim().length < 3}>
                {busy ? "Saving…" : reviewing === "approve" ? "Approve payment" : "Reject payment"}
              </button>
            </span>
          </form>}
        </li>;
      })}
    </ul>
  </>;
}

/** The pending queue, with recently reviewed payments one tab away. */
export function PaymentsPanel({ getToken, onOpenBusiness }: { getToken: () => Promise<string | null>; onOpenBusiness: (tenantId: string) => void }) {
  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);
  const [view, setView] = useState<"pending" | "recent">("pending");
  const [state, load] = useCachedLoad<{ items: SubscriptionPayment[] }>(clientPaths.payments(view), token);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);

  return <div className="clients payments">
    <div className="segmented" role="tablist" aria-label="Show">
      {(["pending", "recent"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => { setNotice(null); setView(id); }}>
        {id === "pending" ? "Waiting for review" : "Recently sent"}
      </button>)}
    </div>
    {notice && <p className="action-success" role="status">{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {state.status === "error" ? <StatePanel error={state.error} dependency="Business API" onRetry={() => void load()} />
      : state.status === "loading" ? <LoadingPanel />
        : state.data.items.length === 0 ? <EmptyPanel title={view === "pending" ? "Nothing to review" : "No payments yet"} body={view === "pending" ? "Proofs of payment appear here when an owner sends one." : "Reviewed and waiting payments appear here."} />
          : <PaymentReviewList payments={state.data.items} token={token} showBusiness onOpenBusiness={onOpenBusiness}
            onReviewed={(result, requestId, decision) => {
              setNotice({ message: `${decision === "approve" ? "Payment approved" : "Payment rejected"} for ${result.tenant.name}. The owner is emailed.`, requestId });
              void load();
            }} />}
    {state.status === "ready" && <p className="muted clients-footnote">Amounts are set by the server from the plan price · Dates in Manila time <RequestId requestId={state.requestId} /></p>}
  </div>;
}

