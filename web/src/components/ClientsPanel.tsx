"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowClockwise, ArrowLeft, CaretRight, CheckCircle, CircleNotch, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { ApiError, apiRequest } from "@/lib/api";
import { useCachedLoad } from "@/lib/view-cache";
import { MutationGuard } from "@/lib/mutations";
import { getTokenWithTimeout } from "@/lib/token";
import {
  clientAttention, clientPaths, clientState, clientStateLabel, clientStateTone, endOfManilaDay, formatManila, manilaDateInput,
  matchesFilter, personLabel,
  type ClientCommandResult, type ClientDetail, type ClientFilter, type ClientMember, type ClientSummary, type PersonRow,
} from "@/lib/clients";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { PaymentReviewList } from "./PaymentReview";
import { StatusBadge } from "./StatusBadge";

type Notice = { message: string; requestId: string } | null;
export type ClientsTab = "businesses" | "people";
export type ClientsNavigation = { client?: string | null; tab?: ClientsTab; filter?: ClientFilter };

const FILTERS: Array<{ id: ClientFilter; label: string }> = [
  { id: "attention", label: "Needs attention" },
  { id: "pending", label: "Payment to review" },
  { id: "trial", label: "On trial" },
  { id: "unpaid", label: "Unpaid" },
  { id: "locked", label: "Locked" },
  { id: "paid", label: "Paid" },
  { id: "all", label: "All" },
];

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http");
}

/**
 * Client administration: every business and person, and the actions an operator takes on them.
 * Navigation state (open business, tab, filter) lives in the URL so links and Back work.
 */
export function ClientsPanel({ getToken, clientId = null, tab = "businesses", filter = "attention", onNavigate }: {
  getToken: () => Promise<string | null>;
  clientId?: string | null;
  tab?: ClientsTab;
  filter?: ClientFilter;
  onNavigate: (next: ClientsNavigation) => void;
}) {
  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);

  if (clientId) return <ClientDetailView tenantId={clientId} token={token} onBack={() => onNavigate({ client: null })} />;
  return <div className="clients">
    <div className="segmented" role="tablist" aria-label="Show">
      {(["businesses", "people"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => onNavigate({ tab: id })}>{id === "businesses" ? "Businesses" : "People"}</button>)}
    </div>
    {tab === "people"
      ? <PeopleList token={token} onOpenBusiness={(id) => onNavigate({ client: id })} />
      : <BusinessList token={token} filter={filter} onFilter={(next) => onNavigate({ filter: next })} onOpen={(id) => onNavigate({ client: id })} />}
  </div>;
}

function BusinessList({ token, filter, onFilter, onOpen }: { token: (signal?: AbortSignal) => Promise<string>; filter: ClientFilter; onFilter: (filter: ClientFilter) => void; onOpen: (id: string) => void }) {
  const [list, load] = useCachedLoad<{ items: ClientSummary[] }>(clientPaths.list, token);
  const [query, setQuery] = useState("");
  const now = useMemo(() => new Date(), [list]);
  if (list.status === "loading") return <LoadingPanel />;
  if (list.status === "error") return <StatePanel error={list.error} dependency="Business API" onRetry={() => void load()} />;

  const all = list.data.items;
  const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, all.filter((client) => matchesFilter(client, id, now)).length])) as Record<ClientFilter, number>;
  const text = query.trim().toLowerCase();
  const rows = all.filter((client) => matchesFilter(client, filter, now)
    && (!text || client.name.toLowerCase().includes(text) || client.slug.includes(text) || client.tenant_id.startsWith(text)));

  return <>
    <div className="clients-toolbar">
      <div className="filter-chips" role="group" aria-label="Filter businesses">
        {FILTERS.map(({ id, label }) => <button key={id} type="button" className={`filter-chip ${filter === id ? "active" : ""} ${id === "attention" && counts.attention > 0 ? "has-alert" : ""}`} aria-pressed={filter === id} onClick={() => onFilter(id)}>
          {label}<span className="chip-count">{counts[id]}</span>
        </button>)}
      </div>
      <div className="clients-search-row">
        <label className="clients-search"><span className="visually-hidden">Find a business</span><MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a business by name, storefront or ID" /></label>
        <button className="button button-secondary" type="button" onClick={() => void load()}><ArrowClockwise size={15} /> Refresh</button>
      </div>
    </div>
    {rows.length === 0
      ? <EmptyPanel title={all.length === 0 ? "No businesses yet" : filter === "attention" && !text ? "Nothing needs attention" : "No business matches"}
          body={all.length === 0 ? "Businesses appear here after an owner finishes onboarding." : filter === "attention" && !text ? "No payment is waiting, no trial or paid month ends in the next 3 days, and every business has full access." : "Try another filter or search term."} />
      : <ul className="data-list client-list" aria-label="Businesses">
        <li className="data-list-head" aria-hidden="true"><span>Business</span><span>Status</span><span>What to know</span><span>Plan</span><span>Staff</span><span>Joined</span><span /></li>
        {rows.map((client) => {
          const state = clientState(client);
          return <li key={client.tenant_id} className={`data-row state-${state}`}>
            <button type="button" className="row-link" onClick={() => onOpen(client.tenant_id)}>
              <span className="row-title">{client.name}</span><span className="row-sub">/s/{client.slug}</span>
            </button>
            <dl className="row-fields">
              <div className="field-status"><dt>Status</dt><dd><StatusBadge value={clientStateTone[state]} label={clientStateLabel[state]} /></dd></div>
              <div className="field-note"><dt>What to know</dt><dd>{clientAttention(client, now)}</dd></div>
              <div><dt>Plan</dt><dd className="capitalize">{client.subscription?.plan_code ?? "—"}</dd></div>
              <div><dt>Staff</dt><dd>{client.member_counts.active} active{client.member_counts.suspended > 0 ? ` · ${client.member_counts.suspended} suspended` : ""}</dd></div>
              <div><dt>Joined</dt><dd>{formatManila(client.created_at)}</dd></div>
            </dl>
            <CaretRight className="row-chevron" size={16} aria-hidden="true" />
          </li>;
        })}
      </ul>}
    <p className="muted clients-footnote">{rows.length} of {all.length} businesses · Dates in Manila time <RequestId requestId={list.requestId} /></p>
  </>;
}

function PeopleList({ token, onOpenBusiness }: { token: (signal?: AbortSignal) => Promise<string>; onOpenBusiness: (tenantId: string) => void }) {
  const [people, load] = useCachedLoad<{ items: PersonRow[] }>(clientPaths.people, token);
  const [query, setQuery] = useState("");
  if (people.status === "loading") return <LoadingPanel />;
  if (people.status === "error") return <StatePanel error={people.error} dependency="Business API" onRetry={() => void load()} />;
  const all = people.data.items;
  const text = query.trim().toLowerCase();
  const rows = all.filter((person) => !text
    || [person.profile?.name, person.profile?.email, person.clerk_user_id, person.tenant_name].some((value) => value?.toLowerCase().includes(text)));
  return <>
    <div className="clients-toolbar">
      <div className="clients-search-row">
        <label className="clients-search"><span className="visually-hidden">Find a person</span><MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person by name, email, user ID or business" /></label>
        <button className="button button-secondary" type="button" onClick={() => void load()}><ArrowClockwise size={15} /> Refresh</button>
      </div>
    </div>
    {rows.length === 0 ? <EmptyPanel title={all.length === 0 ? "No people yet" : "No person matches"} body={all.length === 0 ? "Owners and staff appear here after onboarding." : "Try a different name, email or business."} />
      : <ul className="data-list people-list" aria-label="People">
        <li className="data-list-head" aria-hidden="true"><span>Person</span><span>Business</span><span>Role</span><span>Access</span><span>Last sign-in</span><span /></li>
        {rows.map((person) => {
          const label = personLabel(person);
          return <li key={person.membership_id} className="data-row">
            <button type="button" className="row-link" onClick={() => onOpenBusiness(person.tenant_id)} aria-label={`${label.primary}, ${person.tenant_name}. Open business`}>
              <span className="row-title">{label.primary}</span>{label.secondary && <span className="row-sub">{label.secondary}</span>}
            </button>
            <dl className="row-fields">
              <div><dt>Business</dt><dd>{person.tenant_name}</dd></div>
              <div><dt>Role</dt><dd>{person.role === "owner" ? "Owner" : "Front desk"}</dd></div>
              <div className="field-status"><dt>Access</dt><dd><StatusBadge value={person.status} />{person.profile?.banned && <> <StatusBadge value="banned" /></>}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatManila(person.profile?.last_sign_in_at, true)}</dd></div>
            </dl>
            <CaretRight className="row-chevron" size={16} aria-hidden="true" />
          </li>;
        })}
      </ul>}
    <p className="muted clients-footnote">{rows.length} of {all.length} people · Suspend or reactivate someone from their business <RequestId requestId={people.requestId} /></p>
  </>;
}

function ClientDetailView({ tenantId, token, onBack }: { tenantId: string; token: (signal?: AbortSignal) => Promise<string>; onBack: () => void }) {
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
  const canSetTrial = subscription !== null && subscription.status !== "active" && subscription.status !== "cancelled";
  const canExtendViewOnly = state === "view_only" || state === "expired";
  const extensionDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.grace_ends_at ? new Date(subscription.grace_ends_at).getTime() : 0)), 7);
  const trialDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : 0)), 7);
  const paidDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.status === "active" ? new Date(subscription.current_period_end).getTime() : 0)), 30);

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
            <div><dt>Trial ends</dt><dd>{formatManila(subscription?.trial_ends_at, true)}</dd></div>
            <div><dt>Paid until</dt><dd>{subscription?.status === "active" ? formatManila(subscription.current_period_end, true) : "—"}</dd></div>
            <div><dt>Time zone</dt><dd>{client.timezone}</dd></div>
            <div><dt>Joined</dt><dd>{formatManila(client.created_at)}</dd></div>
            <div className="fact-wide"><dt>Business ID</dt><dd className="mono">{client.tenant_id}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <h3>Payments</h3>
          <p className="muted panel-intro">Proofs the owner sent from Subscribe. Approving gives one more paid month from the later of today or the current end date, and emails the owner.</p>
          {client.payments.length === 0 ? <p className="muted">No payments sent yet.</p>
            : <PaymentReviewList payments={client.payments} token={token}
              onReviewed={(result, requestId, decision) => {
                replaceDetail(result.tenant, requestId);
                setNotice({ message: decision === "approve" ? "Payment approved. The owner is emailed and has full access again." : "Payment rejected. The owner sees your reason.", requestId });
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

        <section className="panel">
          <h3>Recent activity</h3>
          {client.recent_audit.length === 0 ? <p className="muted">No recorded activity yet.</p>
            : <ol className="activity-list">{client.recent_audit.map((entry, index) => <li key={`${entry.occurred_at}-${index}`}>
              <time dateTime={entry.occurred_at}>{formatManila(entry.occurred_at, true)}</time>
              <span className="activity-action">{entry.action}</span>
              <span className="muted">{entry.actor_kind === "operator" ? "Drezivo operator" : entry.actor_kind === "staff" ? "Business staff" : "System"}{entry.outcome !== "succeeded" ? ` · ${entry.outcome}` : ""}</span>
            </li>)}</ol>}
          <RequestId requestId={detail.requestId} />
        </section>
      </div>

      <aside className="client-side" aria-label="Actions">
        {subscription && subscription.status !== "cancelled" && <ActionCard id="activate" open={openAction === "activate"} onToggle={setOpenAction} title={subscription.status === "active" ? "Extend paid period" : "Record a payment"}
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

/** Operator-only notes, newest first. The owner never sees them. */
function NotesSection({ notes, busy, pending, onAdd }: { notes: ClientDetail["notes"]; busy: boolean; pending: boolean; onAdd: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const text = body.trim();
  return <section className="panel">
    <h3>Notes</h3>
    <p className="muted panel-intro">For operators only. Calls, promises to pay, anything the next operator should know.</p>
    <form className="note-form" onSubmit={async (event) => { event.preventDefault(); if (busy || text.length === 0) return; if (await onAdd(text)) setBody(""); }}>
      <label><span className="visually-hidden">New note</span>
        <textarea rows={2} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} disabled={busy} placeholder="Add a note" /></label>
      <button className="button button-secondary" type="submit" disabled={busy || text.length === 0}>{pending ? <><CircleNotch className="spin" size={15} /> Saving…</> : "Add note"}</button>
    </form>
    {notes.length === 0 ? <p className="muted">No notes yet.</p>
      : <ol className="note-list">{notes.map((note) => <li key={note.id}>
        <p className="note-meta"><span>{note.author_label}</span> · <time dateTime={note.created_at}>{formatManila(note.created_at, true)}</time></p>
        <p className="note-body">{note.body}</p>
      </li>)}</ol>}
  </section>;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return <button className="text-button client-back" type="button" onClick={onBack}><ArrowLeft size={15} /> All businesses</button>;
}

function MemberRow({ member, busy, pending, onAction }: { member: ClientMember; busy: boolean; pending: string | null; onAction: (action: "suspend" | "reactivate", reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = member.status === "active" ? "suspend" : member.status === "suspended" ? "reactivate" : null;
  const intent = action ? `member:${member.membership_id}:${action}` : "";
  const label = personLabel(member);
  return <li className="data-row">
    <div className="row-person"><span className="row-title">{label.primary}</span>{label.secondary && <span className="row-sub">{label.secondary}</span>}
      {label.primary !== member.clerk_user_id && <span className="row-sub mono">{member.clerk_user_id}</span>}</div>
    <dl className="row-fields">
      <div><dt>Role</dt><dd>{member.role === "owner" ? "Owner" : "Front desk"}</dd></div>
      <div className="field-status"><dt>Access</dt><dd><StatusBadge value={member.status} /></dd></div>
      <div><dt>Added</dt><dd>{formatManila(member.created_at)}</dd></div>
    </dl>
    <div className="row-actions">{action && !open && <button className="table-action" type="button" disabled={busy} onClick={() => setOpen(true)}>{action === "suspend" ? "Suspend" : "Reactivate"}</button>}</div>
    {action && open && <form className="row-form" onSubmit={async (event) => { event.preventDefault(); if (busy || reason.trim().length < 3) return; if (await onAction(action, reason.trim())) { setOpen(false); setReason(""); } }}>
      <label>Reason<textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      <span><button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
        <button className={`button ${action === "suspend" ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || reason.trim().length < 3}>{pending === intent ? "Saving…" : action === "suspend" ? "Confirm suspend" : "Confirm reactivate"}</button></span>
    </form>}
  </li>;
}

type FieldValues = Record<string, string | undefined>;

function ActionCard({ id, open, onToggle, title, description, submitLabel, tone = "default", busy, pending, fields, onSubmit }: {
  id: string; open: boolean; onToggle: (id: string | null) => void;
  title: string; description: string; submitLabel: string; tone?: "default" | "danger"; busy: boolean; pending: boolean;
  fields?: (values: FieldValues, set: (name: string, value: string) => void) => ReactNode;
  onSubmit: (reason: string, values: FieldValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState<FieldValues>({});
  const [reason, setReason] = useState("");
  const formId = `action-${id}`;
  const close = () => { setReason(""); setValues({}); onToggle(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || reason.trim().length < 3) return;
    if (await onSubmit(reason.trim(), values)) { setReason(""); setValues({}); }
  };
  return <section className={`panel action-card ${tone === "danger" ? "action-danger" : ""} ${open ? "is-open" : ""}`}>
    <h3><button type="button" className="action-toggle" aria-expanded={open} aria-controls={formId} disabled={busy && !open} onClick={() => (open ? close() : onToggle(id))}>
      <span>{title}</span><CaretRight size={15} aria-hidden="true" className="action-caret" />
    </button></h3>
    <p className="muted panel-intro">{description}</p>
    {open && <form id={formId} className="action-form" onSubmit={submit}>
      {fields?.(values, (name, value) => setValues((current) => ({ ...current, [name]: value })))}
      <label>Reason<span className="field-hint">Saved in the activity log</span><textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} autoFocus /></label>
      <div className="action-buttons">
        <button type="button" className="text-button" disabled={busy} onClick={close}>Cancel</button>
        <button className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || reason.trim().length < 3}>
          {pending ? <><CircleNotch className="spin" size={15} /> Saving…</> : submitLabel}
        </button>
      </div>
    </form>}
  </section>;
}
