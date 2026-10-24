"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { getTokenWithTimeout } from "@/lib/token";
import { MutationGuard } from "@/lib/mutations";
import { formatManila } from "@/lib/clients";
import { BusinessSelect } from "./BusinessSelect";
import { AccessPermissions } from "./AccessPermissions";
import { GrantHistory } from "./GrantHistory";

type Access = { grant_id: string; tenant_id: string; expires_at: string; mode: "read" | "repair" };
export function SupportAccessPanel({ getToken, currentOperatorId, onKeepSidebarScroll }: { getToken: () => Promise<string | null>; currentOperatorId?: string | null; onKeepSidebarScroll: () => void }) {
  const [business, setBusiness] = useState("");
  const [mode, setMode] = useState<"read" | "repair">("read");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<Access | null>(null);
  const guard = useRef(new MutationGuard());
  const token = useCallback(async () => { const value = await getTokenWithTimeout(getToken); if (!value) throw new ApiError("Operator sign-in is required.", "unauthorized"); return value; }, [getToken]);
  async function create(event: FormEvent) {
    event.preventDefault(); if (guard.current.isPending || !business || reason.trim().length < 3) return;
    const body = { mode, reason: reason.trim(), minutes };
    setPending(true); setError(null);
    try {
      const result = await guard.current.run("workspace-access", { tenantId: business, ...body }, async idempotencyKey => apiRequest<Access>(`/tenants/${business}/workspace`, { token: await token(), method: "POST", body, idempotencyKey }));
      if (result) setCreated(result.data);
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError("Support access could not be created. Your choices have been kept.", "http")); }
    finally { setPending(false); }
  }
  return <div className="support-access-page">
    <section className="panel support-access-create"><div className="card-heading"><div><h2>Create support access</h2><p className="muted">Choose a business, select what you need to do, and enter your support reason. Access belongs to your individual Superadmin account.</p></div></div>
      {created ? <div className="access-created" role="status"><h3>{created.mode === "repair" ? "Repair access is ready" : "Read-only access is ready"}</h3><p>Available until {formatManila(created.expires_at, true)} (Manila). Your actions will be recorded under your operator account.</p><div className="action-buttons"><Link className="button button-primary" href={`/?view=clients&client=${created.tenant_id}&workspaceGrant=${created.grant_id}`} scroll={false} onClick={onKeepSidebarScroll}>Open workspace</Link><button className="button button-secondary" type="button" onClick={() => { setCreated(null); setReason(""); setMode("read"); }}>Create another access</button></div></div> : <form className="support-access-form" onSubmit={create}>
        <div className="support-access-fields"><BusinessSelect token={token} value={business} onChange={setBusiness} required disabled={pending} /><label>Access duration<select value={minutes} disabled={pending} onChange={e => setMinutes(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label></div>
        <AccessPermissions mode={mode} onChange={setMode} disabled={pending} />
        <label>Support reason<span className="field-hint">Describe the issue you are investigating. Avoid customer contact details or private documents.</span><textarea required minLength={3} maxLength={500} rows={3} value={reason} disabled={pending} onChange={e => setReason(e.target.value)} placeholder="For example: investigate an incorrectly encoded clothing item" /></label>
        {error && <p className="field-error" role="alert">{error.message}{error.requestId && <> Request: {error.requestId}</>}</p>}
        <div className="action-buttons"><p className="field-hint">Access starts immediately and expires automatically. You can revoke it sooner below.</p><button className="button button-primary" type="submit" disabled={pending || !business || reason.trim().length < 3}>{pending ? "Creating access…" : "Create support access"}</button></div>
      </form>}
    </section>
    <GrantHistory key={created?.grant_id ?? "history"} getToken={getToken} currentOperatorId={currentOperatorId} onKeepSidebarScroll={onKeepSidebarScroll} />
  </div>;
}
