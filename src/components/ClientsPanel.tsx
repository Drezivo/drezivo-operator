"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowClockwise, ArrowLeft, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { ApiError, apiRequest } from "@/lib/api";
import { MutationGuard } from "@/lib/mutations";
import { getTokenWithTimeout } from "@/lib/token";
import {
  clientAttention, clientPaths, endOfManilaDay, formatManila, manilaDateInput, personLabel,
  type ClientCommandResult, type ClientDetail, type ClientMember, type ClientSummary, type PersonRow,
} from "@/lib/clients";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { StatusBadge } from "./StatusBadge";

type Load<T> = { status: "loading" } | { status: "ready"; data: T; requestId: string } | { status: "error"; error: ApiError };
type Notice = { message: string; requestId: string } | null;

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http");
}

export function ClientsPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const [list, setList] = useState<Load<ClientSummary[]>>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"businesses" | "people">("businesses");

  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);

  const loadList = useCallback(async (signal?: AbortSignal) => {
    setList({ status: "loading" });
    try {
      const result = await apiRequest<{ items: ClientSummary[] }>(clientPaths.list, { token: await token(signal), signal });
      setList({ status: "ready", data: result.data.items, requestId: result.requestId });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setList({ status: "error", error: asApiError(error) });
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [loadList]);

  if (selectedId) {
    return <ClientDetailView tenantId={selectedId} token={token} onBack={() => { setSelectedId(null); void loadList(); }} />;
  }
  const tabs = <div className="segmented" role="tablist" aria-label="Clients views">
    <button type="button" role="tab" aria-selected={tab === "businesses"} className={tab === "businesses" ? "active" : ""} onClick={() => setTab("businesses")}>Businesses</button>
    <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>People</button>
  </div>;
  if (tab === "people") return <div className="clients">{tabs}<PeopleList token={token} onOpenBusiness={setSelectedId} /></div>;
  if (list.status === "loading") return <LoadingPanel />;
  if (list.status === "error") return <StatePanel error={list.error} dependency="Business API" onRetry={() => void loadList()} />;

  const query = filter.trim().toLowerCase();
  const rows = list.data.filter((client) => !query || client.name.toLowerCase().includes(query) || client.slug.includes(query) || client.tenant_id.includes(query));
  return <div className="clients">
    {tabs}
    <div className="clients-toolbar">
      <label className="clients-search">Find a business<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Name, storefront slug or ID" /></label>
      <button className="button button-secondary" type="button" onClick={() => void loadList()}><ArrowClockwise size={15} /> Refresh</button>
    </div>
    {rows.length === 0 ? <EmptyPanel title={list.data.length === 0 ? "No businesses yet" : "No business matches"} body={list.data.length === 0 ? "Businesses appear here after an owner finishes onboarding." : "Try a different name, slug or ID."} />
      : <div className="table-wrap"><table>
        <thead><tr><th>Business</th><th>Account</th><th>Plan</th><th>Subscription</th><th>What to know</th><th>Staff</th><th>Joined</th><th><span className="visually-hidden">Action</span></th></tr></thead>
        <tbody>{rows.map((client) => <tr key={client.tenant_id}>
          <td><strong>{client.name}</strong><br /><span className="muted">/s/{client.slug}</span></td>
          <td><StatusBadge value={client.status} /></td>
          <td>{client.subscription?.plan_code ?? "—"}</td>
          <td>{client.subscription ? <StatusBadge value={client.subscription.status} /> : "—"}</td>
          <td>{clientAttention(client)}</td>
          <td>{client.member_counts.active} active{client.member_counts.suspended > 0 ? `, ${client.member_counts.suspended} suspended` : ""}</td>
          <td>{formatManila(client.created_at)}</td>
          <td><button className="table-action" type="button" onClick={() => setSelectedId(client.tenant_id)}>Manage</button></td>
        </tr>)}</tbody>
      </table></div>}
    <p className="muted clients-footnote">Dates are shown in Manila time. <RequestId requestId={list.requestId} /></p>
  </div>;
}

function ClientDetailView({ tenantId, token, onBack }: { tenantId: string; token: (signal?: AbortSignal) => Promise<string>; onBack: () => void }) {
  const [detail, setDetail] = useState<Load<ClientDetail>>({ status: "loading" });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const guard = useRef(new MutationGuard());

  const load = useCallback(async (signal?: AbortSignal) => {
    setDetail({ status: "loading" });
    try {
      const result = await apiRequest<ClientDetail>(clientPaths.detail(tenantId), { token: await token(signal), signal });
      setDetail({ status: "ready", data: result.data, requestId: result.requestId });
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setDetail({ status: "error", error: asApiError(loadError) });
    }
  }, [tenantId, token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
      setDetail({ status: "ready", data: result.data.tenant, requestId: result.requestId });
      const suffix = result.data.replayed ? " (already applied — nothing ran twice)" : result.data.changed ? "" : " (no change was needed)";
      setNotice({ message: `${success}${suffix}`, requestId: result.requestId });
      return true;
    } catch (commandError) {
      setError(asApiError(commandError));
      return false;
    } finally {
      setPending(null);
    }
  }, [token]);

  if (detail.status === "loading") return <LoadingPanel />;
  if (detail.status === "error") return <><BackButton onBack={onBack} /><StatePanel error={detail.error} dependency="Business API" onRetry={() => void load()} /></>;
  const client = detail.data;
  const subscription = client.subscription;
  const busy = pending !== null;
  const locked = client.status === "restricted";
  const canSetTrial = subscription !== null && subscription.status !== "active" && subscription.status !== "cancelled";
  const trialDefault = manilaDateInput(new Date(Math.max(Date.now(), subscription?.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : 0)), 7);

  return <div className="clients">
    <BackButton onBack={onBack} />
    <section className="grant-card client-summary">
      <div className="card-heading"><div><span className="eyebrow">Business</span><h2>{client.name}</h2></div><StatusBadge value={client.status} /></div>
      <dl className="client-facts">
        <div><dt>Storefront</dt><dd>/s/{client.slug}</dd></div>
        <div><dt>Time zone</dt><dd>{client.timezone}</dd></div>
        <div><dt>Plan</dt><dd>{subscription?.plan_code ?? "—"}</dd></div>
        <div><dt>Subscription</dt><dd>{subscription ? <StatusBadge value={subscription.status} /> : "—"}</dd></div>
        <div><dt>Trial ends</dt><dd>{formatManila(subscription?.trial_ends_at, true)}</dd></div>
        <div><dt>Paid until</dt><dd>{subscription?.status === "active" ? formatManila(subscription.current_period_end, true) : "—"}</dd></div>
        <div><dt>Joined</dt><dd>{formatManila(client.created_at)}</dd></div>
        <div><dt>Business ID</dt><dd className="mono">{client.tenant_id}</dd></div>
      </dl>
      <p className="client-attention">{clientAttention(client)}</p>
    </section>

    {notice && <p className="action-success" role="status"><CheckCircle size={16} />{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}

    <div className="client-actions">
      <ActionCard title={locked ? "Unlock business" : "Lock business"} eyebrow="Account"
        description={locked ? "Staff get their normal permissions back. Refused while the subscription itself is restricted — extend the trial or mark it paid instead." : "Staff can still sign in and see their data, but every change is blocked until you unlock."}
        submitLabel={locked ? "Unlock" : "Lock business"} danger={!locked} busy={busy} pending={pending === "lock"}
        onSubmit={(reason) => run("lock", locked ? clientPaths.unlock(tenantId) : clientPaths.lock(tenantId), { reason }, locked ? "Business unlocked." : "Business locked.")} />

      {canSetTrial && <ActionCard title="Set trial end" eyebrow="Trial" description="Pick the last day of the trial (Manila time, up to 90 days ahead). A business whose trial already lapsed is restored."
        submitLabel="Save trial end" busy={busy} pending={pending === "trial"}
        fields={(values, set) => <label>Last trial day<input type="date" required value={values.date ?? trialDefault} onChange={(event) => set("date", event.target.value)} /></label>}
        onSubmit={(reason, values) => {
          const end = endOfManilaDay(values.date ?? trialDefault);
          if (!end) { setError(new ApiError("Choose a valid date.", "http")); return Promise.resolve(false); }
          return run("trial", clientPaths.trial(tenantId), { trial_ends_at: end, reason }, "Trial end saved.");
        }} />}

      {subscription && subscription.status !== "cancelled" && <ActionCard title={subscription.status === "active" ? "Extend paid period" : "Mark as paid"} eyebrow="Payment"
        description="Use after you verified the payment (GCash, Maya, bank transfer or cash). Pick the last day the payment covers."
        submitLabel={subscription.status === "active" ? "Save paid period" : "Mark as paid"} busy={busy} pending={pending === "activate"}
        fields={(values, set) => <label>Paid until<input type="date" required value={values.date ?? manilaDateInput(new Date(), 30)} onChange={(event) => set("date", event.target.value)} /></label>}
        onSubmit={(reason, values) => {
          const end = endOfManilaDay(values.date ?? manilaDateInput(new Date(), 30));
          if (!end) { setError(new ApiError("Choose a valid date.", "http")); return Promise.resolve(false); }
          return run("activate", clientPaths.activate(tenantId), { current_period_end: end, reason }, "Payment recorded.");
        }} />}

      <ActionCard title="Edit business details" eyebrow="Profile" description="Correct the business name or time zone. Leave a field as it is to keep it."
        submitLabel="Save details" busy={busy} pending={pending === "profile"}
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
    </div>

    <section className="grant-card client-members">
      <div className="card-heading"><div><span className="eyebrow">Staff</span><h2>People with access</h2></div></div>
      <p className="muted">Suspended staff lose access to this business on their next request. Names and emails come from the business sign-in service when it is connected; otherwise the Clerk user ID is shown.</p>
      {client.members.length === 0 ? <EmptyPanel title="No staff records" body="This business has no memberships." /> : <div className="table-wrap"><table>
        <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Added</th><th><span className="visually-hidden">Action</span></th></tr></thead>
        <tbody>{client.members.map((member) => <MemberRow key={member.membership_id} member={member} busy={busy} pending={pending}
          onAction={(action, reason) => run(`member:${member.membership_id}:${action}`, clientPaths.member(tenantId, member.membership_id, action), { reason }, action === "suspend" ? "Staff member suspended." : "Staff member reactivated.")} />)}</tbody>
      </table></div>}
    </section>

    <section className="grant-card client-audit">
      <div className="card-heading"><div><span className="eyebrow">History</span><h2>Recent activity</h2></div></div>
      {client.recent_audit.length === 0 ? <p className="muted">No recorded activity yet.</p> : <ul className="audit-list">{client.recent_audit.map((entry, index) =>
        <li key={`${entry.occurred_at}-${index}`}><span className="muted">{formatManila(entry.occurred_at, true)}</span> <strong>{entry.action}</strong> <span className="muted">by {entry.actor_kind} · {entry.outcome}</span></li>)}</ul>}
      <RequestId requestId={detail.requestId} />
    </section>
  </div>;
}

function PeopleList({ token, onOpenBusiness }: { token: (signal?: AbortSignal) => Promise<string>; onOpenBusiness: (tenantId: string) => void }) {
  const [people, setPeople] = useState<Load<PersonRow[]>>({ status: "loading" });
  const [filter, setFilter] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setPeople({ status: "loading" });
    try {
      const result = await apiRequest<{ items: PersonRow[] }>(clientPaths.people, { token: await token(signal), signal });
      setPeople({ status: "ready", data: result.data.items, requestId: result.requestId });
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setPeople({ status: "error", error: asApiError(loadError) });
    }
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (people.status === "loading") return <LoadingPanel />;
  if (people.status === "error") return <StatePanel error={people.error} dependency="Business API" onRetry={() => void load()} />;
  const query = filter.trim().toLowerCase();
  const rows = people.data.filter((person) => !query
    || [person.profile?.name, person.profile?.email, person.clerk_user_id, person.tenant_name].some((value) => value?.toLowerCase().includes(query)));
  return <>
    <div className="clients-toolbar">
      <label className="clients-search">Find a person<input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Name, email, user ID or business" /></label>
      <button className="button button-secondary" type="button" onClick={() => void load()}><ArrowClockwise size={15} /> Refresh</button>
    </div>
    {rows.length === 0 ? <EmptyPanel title={people.data.length === 0 ? "No people yet" : "No person matches"} body={people.data.length === 0 ? "Owners and staff appear here after onboarding." : "Try a different name, email or business."} />
      : <div className="table-wrap"><table>
        <thead><tr><th>Person</th><th>Business</th><th>Role</th><th>Access</th><th>Last sign-in</th><th><span className="visually-hidden">Action</span></th></tr></thead>
        <tbody>{rows.map((person) => {
          const label = personLabel(person);
          return <tr key={person.membership_id}>
            <td><strong>{label.primary}</strong>{label.secondary && <><br /><span className="muted">{label.secondary}</span></>}</td>
            <td>{person.tenant_name}{person.tenant_status !== "active" && <> <StatusBadge value={person.tenant_status} /></>}</td>
            <td>{person.role === "owner" ? "Owner" : "Front desk"}</td>
            <td><StatusBadge value={person.status} />{person.profile?.banned && <> <StatusBadge value="banned" /></>}</td>
            <td>{formatManila(person.profile?.last_sign_in_at, true)}</td>
            <td><button className="table-action" type="button" onClick={() => onOpenBusiness(person.tenant_id)}>Open business</button></td>
          </tr>;
        })}</tbody>
      </table></div>}
    <p className="muted clients-footnote">To suspend or reactivate someone, open their business. <RequestId requestId={people.requestId} /></p>
  </>;
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
  return <tr>
    <td><strong>{label.primary}</strong>{label.secondary && <><br /><span className="muted">{label.secondary}</span></>}{label.primary !== member.clerk_user_id && <><br /><span className="muted mono">{member.clerk_user_id}</span></>}</td>
    <td>{member.role === "owner" ? "Owner" : "Front desk"}</td>
    <td><StatusBadge value={member.status} /></td>
    <td>{formatManila(member.created_at)}</td>
    <td>{action && (open
      ? <form className="retry-form" onSubmit={async (event) => { event.preventDefault(); if (busy || reason.trim().length < 3) return; if (await onAction(action, reason.trim())) { setOpen(false); setReason(""); } }}>
        <label>Reason<textarea required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
        <span><button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
          <button className="table-action" type="submit" disabled={busy || reason.trim().length < 3}>{pending === intent ? "Sending…" : action === "suspend" ? "Confirm suspend" : "Confirm reactivate"}</button></span>
      </form>
      : <button className="table-action" type="button" disabled={busy} onClick={() => setOpen(true)}>{action === "suspend" ? "Suspend" : "Reactivate"}</button>)}</td>
  </tr>;
}

type FieldValues = Record<string, string | undefined>;

function ActionCard({ title, eyebrow, description, submitLabel, danger = false, busy, pending, fields, onSubmit }: {
  title: string; eyebrow: string; description: string; submitLabel: string; danger?: boolean; busy: boolean; pending: boolean;
  fields?: (values: FieldValues, set: (name: string, value: string) => void) => ReactNode;
  onSubmit: (reason: string, values: FieldValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState<FieldValues>({});
  const [reason, setReason] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || reason.trim().length < 3) return;
    if (await onSubmit(reason.trim(), values)) { setReason(""); setValues({}); }
  };
  return <section className="grant-card client-action">
    <div className="card-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>
    <p className="grant-intro">{description}</p>
    <form className="grant-form" onSubmit={submit}>
      {fields?.(values, (name, value) => setValues((current) => ({ ...current, [name]: value })))}
      <label className="grant-wide">Reason (saved in the audit log)<textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      <div className="grant-actions">
        <small>Checked and recorded by the operator API.</small>
        <button className={`button ${danger ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || reason.trim().length < 3}>
          {pending ? <><CircleNotch className="spin" size={15} /> Sending…</> : submitLabel}
        </button>
      </div>
    </form>
  </section>;
}
