"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CaretRight, CircleNotch } from "@phosphor-icons/react";
import { personLabel, type ClientDetail, type ClientMember } from "@/features/clients/model";
import { formatManila } from "@/shared/lib/format";
import { StatusBadge } from "@/shared/ui/StatusBadge";

/** Operator-only notes, newest first. The owner never sees them. */
export function NotesSection({ notes, busy, pending, onAdd }: { notes: ClientDetail["notes"]; busy: boolean; pending: boolean; onAdd: (body: string) => Promise<boolean> }) {
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

export function BackButton({ onBack }: { onBack: () => void }) {
  return <button className="text-button client-back" type="button" onClick={onBack}><ArrowLeft size={15} /> All businesses</button>;
}

export function MemberRow({ member, busy, pending, onAction }: { member: ClientMember; busy: boolean; pending: string | null; onAction: (action: "suspend" | "reactivate", reason: string) => Promise<boolean> }) {
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

export function ActionCard({ id, open, onToggle, title, description, submitLabel, tone = "default", busy, pending, fields, onSubmit }: {
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
