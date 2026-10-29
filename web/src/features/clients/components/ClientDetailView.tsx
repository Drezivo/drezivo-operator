"use client";
import { useCallback, useRef, useState } from "react";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { useCachedLoad } from "@/shared/api/view-cache";
import { MutationGuard } from "@/shared/api/mutations";
import { clientPaths } from "@/features/clients/api";
import { clientAttention, clientState, clientStateLabel, clientStateTone, type ClientDetail, type ClientCommandResult } from "@/features/clients/model";
import { formatManila, manilaDateInput, endOfManilaDay } from "@/shared/lib/format";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { PaymentReviewList } from "@/features/payments/components/PaymentReview";
import { ActionCard, BackButton, MemberRow, NotesSection } from "./ClientActions";

type Notice = { message: string; requestId: string } | null;
function asApiError(error: unknown): ApiError { return error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http"); }

export function ClientDetailView({ tenantId, token, onBack }: { tenantId: string; token: (signal?: AbortSignal) => Promise<string>; onBack: () => void }) {
  const [detail, load, replaceDetail] = useCachedLoad<ClientDetail>(clientPaths.detail(tenantId), token);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [openAction, setOpenAction] = useState<string | null>(null);
  const guard = useRef(new MutationGuard());

  /** Runs one operator command: one in flight at a time, same idempotency key when retried. */
  const run = useCallback(async (intent: string, path: string, body: Record<string, unknown>, success: string): Promise<boolean> => {
    if (guard.current.isPending) return false;
    setError(null);
    setNotice(null);
    setPending(intent);
    try {
      const result = await guard.current.run(intent, { path, body }, async (idempotencyKey) =>
        apiRequest<ClientCommandResult>(path, { method: "POST", token: await token(), body, idempotencyKey }));
      if (!result) return false;
      replaceDetail(result.data.tenant, result.requestId);
      const suffix = result.data.replayed ? " It was already done, so nothing ran twice." : result.data.changed ? "" : " Nothing needed to change.";
      setNotice({ message: `${success}${suffix}`, requestId: result.requestId });
      setOpenAction(null);
      return true;
    } catch (commandError) {
      setError(asApiError(commandError));
      return false;
    } finally {
      setPending(null);
    }
  }, [replaceDetail, token]);

  if (detail.status === "loading") return <div className="clients"><BackButton onBack={onBack} /><LoadingPanel /></div>;
  if (detail.status === "error") return <div className="clients"><BackButton onBack={onBack} /><StatePanel error={detail.error} dependency="Business API" onRetry={() => void load()} /></div>;
  const client = detail.data;
  const subscription = client.subscription;
  const state = clientState(client);
  const busy = pending !== null;
  const locked = state === "locked";
  const canSetTrial = subscription !== null && subscription.plan_code !== "free" && subscription.status !== "active" && subscription.status !== "cancelled";
  const canExtendViewOnly = state === "view_only" || state === "expired";
  const extensionDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.grace_ends_at ? new Date(subscription.grace_ends_at).getTime() : 0)), 7);
  const now = Date.now();
  const currentTrialEnd = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : Number.NaN;
  const trialDefault = currentTrialEnd > now
    ? manilaDateInput(new Date(currentTrialEnd), 0)
    : manilaDateInput(new Date(now), 7);
  const paidDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.status === "active" && subscription.current_period_end ? new Date(subscription.current_period_end).getTime() : 0)), 30);

  return <div className="clients client-detail">
    <BackButton onBack={onBack} />
    <header className="client-header">
      <div><h2>{client.name}</h2><p className="muted">/s/{client.slug}</p></div>
      <StatusBadge value={clientStateTone[state]} label={clientStateLabel[state]} />
    </header>
    <p className={`client-attention attention-${state}`}>{state === "locked" || state === "restricted" || state === "unpaid" ? <WarningCircle size={17} aria-hidden="true" /> : <CheckCircle size={17} aria-hidden="true" />}{clientAttention(client)}</p>
    {notice && <p className="action-success" role="status"><CheckCircle size={16} />{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}

    <div className="client-layout">
      <div className="client-main">
        <section className="panel">
          <h3>Account</h3>
          <dl className="client-facts">
            <div><dt>Plan</dt><dd className="capitalize">{subscription?.plan_code ?? "—"}</dd></div>
            <div><dt>Subscription</dt><dd>{subscription ? <StatusBadge value={subscription.status} /> : "—"}</dd></div>
            {subscription?.plan_code === "free" ? <div><dt>Renewal</dt><dd>No renewal due</dd></div> : <>
              <div><dt>Trial ends</dt><dd>{formatManila(subscription?.trial_ends_at, true)}</dd></div>
              <div><dt>Paid until</dt><dd>{subscription?.status === "active" ? formatManila(subscription.current_period_end, true) : "—"}</dd></div>
            </>}
            <div><dt>Time zone</dt><dd>{client.timezone}</dd></div>
            <div><dt>Joined</dt><dd>{formatManila(client.created_at)}</dd></div>
            <div className="fact-wide"><dt>Business ID</dt><dd className="mono">{client.tenant_id}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <h3>Payments</h3>
          <p className="muted panel-intro">{subscription?.plan_code === "free" ? "Upgrade proofs from Subscribe. Approval queues activation of the requested paid plan and an owner notification." : "Proofs the owner sent from Subscribe. Approving gives one more paid month from the later of today or the current end date, and queues an email to the owner."}</p>
          {client.payments.length === 0 ? <p className="muted">No payments sent yet.</p>
            : <PaymentReviewList payments={client.payments} token={token}
              onReviewed={(result, requestId, decision) => {
                replaceDetail(result.tenant, requestId);
                setNotice({ message: decision === "approve" ? result.tenant.subscription?.plan_code === "free" ? "Payment approved. Upgrade activation and an owner notification are queued." : "Payment approved. The paid period has been updated. An email notification is queued." : "Payment rejected. The owner can see your reason in the app.", requestId });
              }} />}
        </section>

        <NotesSection notes={client.notes} busy={busy} pending={pending === "note"}
          onAdd={(body) => run("note", clientPaths.notes(tenantId), { body }, "Note added.")} />

        <section className="panel">
          <h3>People with access</h3>
          <p className="muted panel-intro">A suspended person loses access to this business on their next request.</p>
          {client.members.length === 0 ? <EmptyPanel title="No staff records" body="This business has no memberships." />
            : <ul className="data-list staff-list" aria-label="People with access">
              <li className="data-list-head" aria-hidden="true"><span>Person</span><span>Role</span><span>Access</span><span>Added</span><span /></li>
              {[...client.members].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner")).map((member) => <MemberRow key={member.membership_id} member={member} busy={busy} pending={pending}
                onAction={(action, reason) => run(`member:${member.membership_id}:${action}`, clientPaths.member(tenantId, member.membership_id, action), { reason }, action === "suspend" ? "Access suspended." : "Access restored.")} />)}
            </ul>}
        </section>


      </div>

      <aside className="client-side" aria-label="Actions">
        {subscription && subscription.plan_code !== "free" && subscription.status !== "cancelled" && <ActionCard id="activate" open={openAction === "activate"} onToggle={setOpenAction} title={subscription.status === "active" ? "Extend paid period" : "Record a payment"}
          description="Only for a payment the owner did not send through Subscribe (for example cash). Proofs sent in the app are approved under Payments. Pick the last day it covers."
          submitLabel={subscription.status === "active" ? "Save paid period" : "Mark as paid"} busy={busy} pending={pending === "activate"}
          fields={(values, set) => <label>Paid until<input type="date" required value={values.date ?? paidDefault} onChange={(event) => set("date", event.target.value)} /></label>}
          onSubmit={(reason, values) => {
            const end = endOfManilaDay(values.date ?? paidDefault);
            if (!end) { setError(new ApiError("Choose a valid date.", "http")); return Promise.resolve(false); }
            return run("activate", clientPaths.activate(tenantId), { current_period_end: end, reason }, "Payment recorded.");
          }} />}

        {canExtendViewOnly && <ActionCard id="extend" open={openAction === "extend"} onToggle={setOpenAction} title="Extend view-only access"
          description="Staff can look but not change anything, and the storefront stays up without bookings, until the end of this day. Up to 90 days ahead."
          submitLabel="Save view-only date" busy={busy} pending={pending === "extend"}
          fields={(values, set) => <label>View-only until<input type="date" required value={values.date ?? extensionDefault} onChange={(event) => set("date", event.target.value)} /></label>}
          onSubmit={(reason, values) => {
            const end = endOfManilaDay(values.date ?? extensionDefault);
            if (!end) { setError(new ApiError("Choose a valid date.", "http")); return Promise.resolve(false); }
            return run("extend", clientPaths.readOnlyExtension(tenantId), { read_only_until: end, reason }, "View-only access extended.");
          }} />}

        {canSetTrial && <ActionCard id="trial" open={openAction === "trial"} onToggle={setOpenAction} title="Set trial end" description="Pick the last day of the trial, up to 90 days ahead. A business whose trial lapsed is restored."
          submitLabel="Save trial end" busy={busy} pending={pending === "trial"}
          fields={(values, set) => <label>Last trial day<input type="date" required value={values.date ?? trialDefault} onChange={(event) => set("date", event.target.value)} /></label>}
          onSubmit={(reason, values) => {
            const end = endOfManilaDay(values.date ?? trialDefault);
            if (!end) { setError(new ApiError("Choose a valid date.", "http")); return Promise.resolve(false); }
            return run("trial", clientPaths.trial(tenantId), { trial_ends_at: end, reason }, "Trial end saved.");
          }} />}

        <ActionCard id="profile" open={openAction === "profile"} onToggle={setOpenAction} title="Edit business details" description="Correct the business name or time zone." submitLabel="Save details" busy={busy} pending={pending === "profile"}
          fields={(values, set) => <>
            <label>Business name<input required minLength={2} maxLength={120} value={values.name ?? client.name} onChange={(event) => set("name", event.target.value)} /></label>
            <label>Time zone<input required value={values.timezone ?? client.timezone} onChange={(event) => set("timezone", event.target.value)} placeholder="Asia/Manila" /></label>
          </>}
          onSubmit={(reason, values) => {
            const body: Record<string, unknown> = { reason };
            if (values.name !== undefined && values.name.trim() !== client.name) body.name = values.name.trim();
            if (values.timezone !== undefined && values.timezone.trim() !== client.timezone) body.timezone = values.timezone.trim();
            if (!("name" in body) && !("timezone" in body)) { setError(new ApiError("Change the name or time zone first.", "http")); return Promise.resolve(false); }
            return run("profile", clientPaths.profile(tenantId), body, "Business details saved.");
          }} />

        <ActionCard id="lock" open={openAction === "lock"} onToggle={setOpenAction} tone={locked ? "default" : "danger"} title={locked ? "Unlock business" : "Lock business"}
          description={locked ? "Staff get their normal permissions back. Not available while the subscription itself is restricted: record a payment or set a trial end instead." : "Staff can still sign in and see their records, but every change is blocked until you unlock."}
          submitLabel={locked ? "Unlock business" : "Lock business"} busy={busy} pending={pending === "lock"}
          onSubmit={(reason) => run("lock", locked ? clientPaths.unlock(tenantId) : clientPaths.lock(tenantId), { reason }, locked ? "Business unlocked." : "Business locked.")} />
      </aside>
    </div>
  </div>;
}
