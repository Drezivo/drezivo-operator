"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CircleNotch, Plus } from "@phosphor-icons/react";
import { ApiError, apiBlobRequest, apiRequest } from "@/lib/api";
import { useCachedLoad } from "@/lib/view-cache";
import { MutationGuard } from "@/lib/mutations";
import { getTokenWithTimeout } from "@/lib/token";
import {
  MAX_QR_BYTES, platformPaymentPaths, readQrFile,
  type PlatformPaymentMethod, type PlatformPaymentMethodCommandResult, type PlatformPaymentMethodList,
} from "@/lib/platform-payments";
import { formatManila } from "@/lib/clients";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { StatusBadge } from "./StatusBadge";

type Token = (signal?: AbortSignal) => Promise<string>;
type Draft = { label: string; account_name: string; account_number: string; instructions: string; sort_order: string; qr: "keep" | "remove" | File; reason: string };

const emptyDraft: Draft = { label: "", account_name: "", account_number: "", instructions: "", sort_order: "0", qr: "keep", reason: "" };
const asApiError = (error: unknown) => (error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http"));

/**
 * Drezivo's own payment methods: what a business sees in Subscribe when it pays the ₱300 Standard
 * plan. At most 10 are shown at once. Methods are never deleted, only turned off, so past payments
 * keep their label.
 */
export function PaymentMethodsPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const token = useCallback<Token>(async (signal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);
  const [state, load] = useCachedLoad<PlatformPaymentMethodList>(platformPaymentPaths.list, token);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);
  const guard = useRef(new MutationGuard());

  /** One write at a time; a retry of the same change reuses its idempotency key. */
  const run = useCallback(async (intent: string, path: string, body: Record<string, unknown>, success: string): Promise<boolean> => {
    if (guard.current.isPending) return false;
    setError(null);
    setNotice(null);
    setPending(intent);
    try {
      const result = await guard.current.run(intent, { path, body }, async (idempotencyKey) =>
        apiRequest<PlatformPaymentMethodCommandResult>(path, { method: "POST", token: await token(), body, idempotencyKey }));
      if (!result) return false;
      setNotice({ message: result.data.replayed ? `${success} It was already done, so nothing ran twice.` : success, requestId: result.requestId });
      setEditing(null);
      await load();
      return true;
    } catch (commandError) {
      setError(asApiError(commandError));
      return false;
    } finally {
      setPending(null);
    }
  }, [load, token]);

  if (state.status === "loading") return <LoadingPanel />;
  if (state.status === "error") return <StatePanel error={state.error} dependency="Business API" onRetry={() => void load()} />;
  const { items, max_active: maxActive } = state.data;
  const activeCount = items.filter((method) => method.active).length;
  const busy = pending !== null;

  return <div className="clients payment-methods">
    <div className="clients-toolbar">
      <p className="muted">{activeCount} of {maxActive} shown to businesses</p>
      <button className="button button-primary" type="button" disabled={busy || editing !== null || activeCount >= maxActive}
        title={activeCount >= maxActive ? "Turn a method off before adding another" : undefined} onClick={() => { setNotice(null); setEditing("new"); }}>
        <Plus size={15} /> Add payment method
      </button>
    </div>
    {notice && <p className="action-success" role="status">{notice.message}<RequestId requestId={notice.requestId} /></p>}
    {error && <StatePanel error={error} dependency="Business API" onRetry={() => setError(null)} />}
    {editing === "new" && <section className="panel method-card"><MethodForm busy={busy} pending={pending === "create"} onCancel={() => setEditing(null)}
      onSubmit={async (draft) => run("create", platformPaymentPaths.list, await bodyOf(draft, false), "Payment method added.")} /></section>}
    {items.length === 0 && editing !== "new"
      ? <EmptyPanel title="No payment methods yet" body="Add GCash, Maya or a bank account with its QR code. Businesses see them when they subscribe." />
      : <ul className="method-list" aria-label="Payment methods">{items.map((method) => <li key={method.id} className="panel method-card">
        {editing === method.id
          ? <MethodForm method={method} busy={busy} pending={pending === `update:${method.id}`} onCancel={() => setEditing(null)}
            onSubmit={async (draft) => run(`update:${method.id}`, platformPaymentPaths.update(method.id), { ...(await bodyOf(draft, true)), version: method.version }, "Payment method saved.")} />
          : <MethodView method={method} token={token} busy={busy} pending={pending} canActivate={activeCount < maxActive}
            onEdit={() => { setNotice(null); setEditing(method.id); }}
            onToggle={(reason) => run(`toggle:${method.id}`, platformPaymentPaths.toggle(method.id, method.active ? "deactivate" : "activate"), { version: method.version, reason },
              method.active ? "Payment method turned off." : "Payment method turned on.")} />}
      </li>)}</ul>}
    <p className="muted clients-footnote">Methods are never deleted. Turning one off hides it from Subscribe; past payments keep its name. <RequestId requestId={state.requestId} /></p>
  </div>;
}

async function bodyOf(draft: Draft, editing: boolean): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    label: draft.label.trim(),
    account_name: draft.account_name.trim() || null,
    account_number: draft.account_number.trim() || null,
    instructions: draft.instructions.trim() || null,
    sort_order: Number(draft.sort_order) || 0,
    reason: draft.reason.trim(),
  };
  if (draft.qr instanceof File) body.qr = { data_base64: await readQrFile(draft.qr) };
  else if (draft.qr === "remove") body.qr = null;
  else if (!editing) body.qr = null;
  return body;
}

function MethodView({ method, token, busy, pending, canActivate, onEdit, onToggle }: {
  method: PlatformPaymentMethod; token: Token; busy: boolean; pending: string | null; canActivate: boolean;
  onEdit: () => void; onToggle: (reason: string) => Promise<boolean>;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<ApiError | null>(null);
  const [toggling, setToggling] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);

  async function showQr() {
    setQrError(null);
    try {
      const blob = await apiBlobRequest(platformPaymentPaths.qr(method.id), { token: await token() });
      setQrUrl(URL.createObjectURL(blob));
    } catch (loadError) {
      setQrError(asApiError(loadError));
    }
  }

  const blockedOn = !method.active && !canActivate;
  return <>
    <header className="client-header">
      <div><h3>{method.label}</h3><p className="muted">{[method.account_name, method.account_number].filter(Boolean).join(" · ") || "No account details"}</p></div>
      <StatusBadge value={method.active ? "active" : "disabled"} label={method.active ? "Shown to businesses" : "Off"} />
    </header>
    {method.instructions && <p className="note-body">{method.instructions}</p>}
    <dl className="client-facts">
      <div><dt>Order</dt><dd>{method.sort_order}</dd></div>
      <div><dt>QR code</dt><dd>{method.has_qr ? (qrUrl ? <img className="qr-preview" src={qrUrl} alt={`${method.label} QR code`} /> : <button type="button" className="table-action" onClick={() => void showQr()}>Show QR</button>) : "None"}</dd></div>
      <div><dt>Updated</dt><dd>{formatManila(method.updated_at, true)}</dd></div>
    </dl>
    {qrError && <StatePanel error={qrError} dependency="Business API" onRetry={() => void showQr()} />}
    {toggling
      ? <form className="row-form" onSubmit={async (event: FormEvent) => { event.preventDefault(); if (busy || reason.trim().length < 3) return; if (await onToggle(reason.trim())) { setToggling(false); setReason(""); } }}>
        <label>Reason<span className="field-hint">Saved in the change log</span><textarea required minLength={3} maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} autoFocus /></label>
        <span><button className="text-button" type="button" disabled={busy} onClick={() => { setToggling(false); setReason(""); }}>Cancel</button>
          <button className={`button ${method.active ? "button-danger" : "button-primary"}`} type="submit" disabled={busy || reason.trim().length < 3}>
            {pending === `toggle:${method.id}` ? "Saving…" : method.active ? "Turn off" : "Turn on"}</button></span>
      </form>
      : <div className="action-buttons">
        <button type="button" className="button button-secondary" disabled={busy} onClick={onEdit}>Edit</button>
        <button type="button" className="button button-secondary" disabled={busy || blockedOn} title={blockedOn ? "Turn another method off first" : undefined} onClick={() => setToggling(true)}>
          {method.active ? "Turn off" : "Turn on"}</button>
      </div>}
  </>;
}

function MethodForm({ method, busy, pending, onCancel, onSubmit }: {
  method?: PlatformPaymentMethod; busy: boolean; pending: boolean; onCancel: () => void; onSubmit: (draft: Draft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(method ? {
    label: method.label, account_name: method.account_name ?? "", account_number: method.account_number ?? "",
    instructions: method.instructions ?? "", sort_order: String(method.sort_order), qr: "keep", reason: "",
  } : emptyDraft);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const set = (field: keyof Draft, value: Draft[keyof Draft]) => setDraft((current) => ({ ...current, [field]: value }));
  const ready = draft.label.trim().length > 0 && draft.reason.trim().length >= 3 && !fileProblem;

  return <form className="action-form method-form" onSubmit={async (event) => { event.preventDefault(); if (busy || !ready) return; await onSubmit(draft); }}>
    <h3>{method ? `Edit ${method.label}` : "New payment method"}</h3>
    <label>Name<input required maxLength={80} value={draft.label} onChange={(event) => set("label", event.target.value)} placeholder="GCash, Maya, BPI…" /></label>
    <label>Account name<input maxLength={160} value={draft.account_name} onChange={(event) => set("account_name", event.target.value)} /></label>
    <label>Account number<input maxLength={120} value={draft.account_number} onChange={(event) => set("account_number", event.target.value)} /></label>
    <label>Order<span className="field-hint">Lower numbers show first</span><input type="number" min={0} max={1000} value={draft.sort_order} onChange={(event) => set("sort_order", event.target.value)} /></label>
    <label>Steps for the business<textarea maxLength={1000} rows={2} value={draft.instructions} onChange={(event) => set("instructions", event.target.value)} /></label>
    <label>QR image<span className="field-hint">PNG, JPEG or WebP, up to 512 KB</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) { set("qr", "keep"); setFileProblem(null); return; }
        setFileProblem(file.size > MAX_QR_BYTES ? "The QR image must be 512 KB or smaller." : null);
        set("qr", file);
      }} /></label>
    {fileProblem && <p className="field-error" role="alert">{fileProblem}</p>}
    {method?.has_qr && !(draft.qr instanceof File) && <label className="checkbox-row"><input type="checkbox" checked={draft.qr === "remove"} onChange={(event) => set("qr", event.target.checked ? "remove" : "keep")} /> Remove the current QR image</label>}
    <label>Reason<span className="field-hint">Saved in the change log</span><textarea required minLength={3} maxLength={500} rows={2} value={draft.reason} onChange={(event) => set("reason", event.target.value)} /></label>
    <div className="action-buttons">
      <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="submit" className="button button-primary" disabled={busy || !ready}>{pending ? <><CircleNotch className="spin" size={15} /> Saving…</> : method ? "Save changes" : "Add method"}</button>
    </div>
  </form>;
}
