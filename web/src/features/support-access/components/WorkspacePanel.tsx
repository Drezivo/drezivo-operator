"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { MutationGuard } from "@/shared/api/mutations";
import { StatusBadge } from "@/shared/ui/StatusBadge";
import { AccessPermissions } from "@/features/support-access/components/AccessPermissions";
import { formatManila } from "@/shared/lib/format";

type Scalar = string | number | boolean | null;
type Access = { grant_id: string; tenant_id: string; mode: "read" | "repair"; operator_subject: string; expires_at: string };
type Records = { resource: string; columns: string[]; editable: string[]; deletable: boolean; items: Record<string, Scalar>[]; next_cursor: string | null };
type Detail = { id: string; fingerprint: string; data: Record<string, Scalar>; editable: string[] };
type Preview = { id: string; name: string; code: string; fingerprint: string; variants: number; assets: number; images: number; blockers: Record<string, number>; can_delete: boolean };
const modules = [
  ["clothing", "Clothing"], ["variants", "Sizes & variants"], ["assets", "Physical stock"], ["categories", "Categories"], ["branches", "Branches"],
  ["reservations", "Reservations"], ["reservation-lines", "Reservation items"], ["fittings", "Fittings"], ["fitting-lines", "Fitting items"],
  ["customers", "Customer records"], ["memberships", "Staff records"], ["payments", "Payments"], ["charges", "Charges"], ["deposits", "Deposits"], ["refunds", "Refunds"],
  ["maintenance", "Maintenance"], ["allocations", "Availability allocations"], ["custody", "Custody"], ["disruptions", "Disruptions"], ["storefronts", "Storefronts"], ["files", "File lifecycle"], ["jobs", "Background jobs"],
] as const;
const displayColumns: Record<string,string[]> = {
  clothing:['name','code','status','subcategory','updated_at'], variants:['sku','size_label','color_label','rental_price_minor','status'],
  assets:['asset_code','lifecycle_status','readiness','custody_kind','updated_at'], categories:['name','status','display_order'], branches:['name','code','status','timezone','is_default'],
  reservations:['reference_code','status','pickup_at','due_at','rental_total_minor'], fittings:['status','period','fee_minor','currency'],
  payments:['status','amount_minor','currency','verified_at'], charges:['kind','amount_minor','currency','created_at'], deposits:['kind','amount_minor','currency','created_at'],
  refunds:['status','purpose','amount_minor','currency','completed_at'], memberships:['id','role','status','updated_at'],
  storefronts:['slug','status','published_at','updated_at'], files:['id','purpose','lifecycle_status','mime_type','byte_size'], jobs:['event_type','status','attempts','max_attempts','available_at'],
};
function cellValue(key: string, row: Record<string,Scalar>) {
  const v=row[key];
  if (typeof v==='number' && key.endsWith('_minor')) return new Intl.NumberFormat('en-PH',{style:'currency',currency:typeof row.currency==='string'?row.currency:'PHP'}).format(v/100);
  if (typeof v==='string' && key.endsWith('_at') && /^\d{4}-/.test(v)) return formatManila(v,true);
  if (typeof v==='string' && ['status','readiness','custody_kind','lifecycle_status','role'].includes(key)) return label(v);
  return show(v);
}
const label = (key: string) => key.replaceAll("_", " ");
const show = (v: Scalar | undefined) => v === null || v === undefined ? "—" : typeof v === "boolean" ? v ? "Yes" : "No" : String(v);

export function WorkspacePanel({ tenantId, businessName, token, initialGrantId }: { initialGrantId?: string | null; tenantId: string; businessName: string; token: (signal?: AbortSignal) => Promise<string> }) {
  const [resuming, setResuming] = useState(Boolean(initialGrantId));
  const [access, setAccess] = useState<Access | null>(null);
  const [mode, setMode] = useState<"read" | "repair">("read");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const guard = useRef(new MutationGuard());
  const base = `/tenants/${tenantId}/workspace`;
  useEffect(() => {
    if (!initialGrantId) return;
    const controller = new AbortController(); setResuming(true); setAccess(null); setError(null);
    void (async () => {
      try { const result = await apiRequest<Access>(`${base}/${encodeURIComponent(initialGrantId)}`, { token: await token(), signal: controller.signal }); if (!controller.signal.aborted) setAccess(result.data); }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof ApiError ? e : new ApiError("This access could not be resumed. Open a new session below.", "http")); }
      finally { if (!controller.signal.aborted) setResuming(false); }
    })();
    return () => controller.abort();
  }, [initialGrantId, base, token]);
  const run = async (intent: "open" | "close", body: object) => {
    if (guard.current.isPending) return;
    setPending(true); setError(null); setNotice("");
    try {
      const result = await guard.current.run(intent, body, async key => apiRequest<Access>(intent === "open" ? base : `${base}/${access?.grant_id}/close`, { method: "POST", body, token: await token(), idempotencyKey: key }));
      if (result) {
        if (intent === "open") setAccess(result.data);
        else { setAccess(null); setReason(""); setMode("read"); setNotice("Workspace access closed and revoked.");
          const params = new URLSearchParams(window.location.search); params.delete("workspaceGrant"); window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
        }
      }
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError("Workspace support is unavailable.", "http")); }
    finally { setPending(false); }
  };
  return <section className="panel workspace-panel" aria-label="Workspace administration">
    <header className="workspace-heading"><div><h3>Workspace administration</h3><p className="muted">Open {businessName} to inspect records and repair encoding mistakes. Every access and change identifies your operator account.</p></div></header>
    {error && <p role="alert">{error.message}{error.requestId && <> Request: {error.requestId}</>}</p>}
    {notice && <p role="status">{notice}</p>}
    {resuming ? <p role="status">Checking your workspace access...</p> : !access ? <form className="workspace-access-form" onSubmit={e => { e.preventDefault(); if (!pending && reason.trim().length >= 3) void run("open", { mode, reason: reason.trim(), minutes }); }}>
      <AccessPermissions mode={mode} onChange={setMode} disabled={pending} />
      <label>Access duration<select value={minutes} disabled={pending} onChange={e => setMinutes(Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label>
      <label className="workspace-reason">Support reason<input required minLength={3} maxLength={500} disabled={pending} value={reason} onChange={e => setReason(e.target.value)} placeholder="What are you investigating?" /></label>
      <button type="submit" className="button button-primary" disabled={pending || reason.trim().length < 3}>{pending ? "Opening…" : "Open workspace"}</button>
    </form> : <>
      <div className={`workspace-scope ${access.mode === "repair" ? "workspace-repair" : ""}`}>
        <div><strong>{businessName} · {access.mode === "repair" ? "Repair access" : "Read-only"}</strong><p>Your Superadmin account · expires {formatManila(access.expires_at, true)}</p><details className="technical-details"><summary>Access details</summary><p className="mono">Workspace {tenantId}</p><p>Operator {access.operator_subject}</p></details></div>
        <button className="button button-secondary" type="button" disabled={pending} onClick={() => void run("close", {})}>{pending ? "Closing…" : "Close workspace access"}</button>
      </div>
      <WorkspaceRecords key={access.grant_id} access={access} token={token} />
    </>}
  </section>;
}

function WorkspaceRecords({ access, token }: { access: Access; token: () => Promise<string> }) {
  const [resource, setResource] = useState("clothing");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState(0);
  const [records, setRecords] = useState<Records | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [notice, setNotice] = useState("");
  const base = `/tenants/${access.tenant_id}/workspace/${access.grant_id}`;
  const expired = now >= new Date(access.expires_at).getTime();
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const after = cursors[page];
  const columns = records ? (displayColumns[resource] ?? records.columns).filter(c=>records.columns.includes(c)) : [];
  useEffect(() => {
    const controller = new AbortController();
    setRecords(null); setDetail(null); setPreview(null); setError(null); setLoading(true);
    const params = new URLSearchParams(); if (query) params.set("q", query); if (after) params.set("after", after);
    void (async () => { try {
      const result = await apiRequest<Records>(`${base}/records/${resource}?${params}`, { token: await token(), signal: controller.signal });
      if (!controller.signal.aborted) setRecords(result.data);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof ApiError ? e : new ApiError("The workspace could not be loaded.", "http")); }
    finally { if (!controller.signal.aborted) setLoading(false); } })();
    return () => controller.abort();
  }, [base, resource, query, after, refresh, token]);
  useEffect(() => { if (expired) { setRecords(null); setDetail(null); setPreview(null); } }, [expired]);
  const open = async (id: string, deletion = false) => {
    if (openingRef.current || expired) return;
    openingRef.current = true; setOpening(true); setError(null); setDetail(null); setPreview(null); setNotice("");
    try {
      if (deletion) setPreview((await apiRequest<Preview>(`${base}/clothing/${id}/delete-preview`, { token: await token() })).data);
      else setDetail((await apiRequest<Detail>(`${base}/records/${resource}/${id}`, { token: await token() })).data);
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError("The record could not be opened.", "http")); }
    finally { openingRef.current = false; setOpening(false); }
  };
  const completed = useCallback((message: string) => { setDetail(null); setPreview(null); setNotice(message); setRefresh(x => x + 1); }, []);
  if (expired) return <p role="alert">Workspace access expired. Close this access and open a new troubleshooting session.</p>;
  return <div className="workspace-records">
    <div className="workspace-toolbar">
      <label>Workspace module<select disabled={opening || detail !== null || preview !== null} value={resource} onChange={e => { setResource(e.target.value); setSearch(""); setQuery(""); setCursors([null]); setPage(0); setNotice(""); }}>{modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <form onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setCursors([null]); setPage(0); }}><label>Find a record<input type="search" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} placeholder={resource === "clothing" ? "Clothing name or code" : "Search records"} /></label><button type="submit" className="button button-secondary" disabled={loading || detail !== null || preview !== null}>Search</button></form>
      <button type="button" className="text-button" disabled={loading || opening || detail !== null || preview !== null} onClick={() => setRefresh(x => x + 1)}>Refresh records</button>
    </div>
    <p className="muted">Customer contact details, private evidence and storage credentials are excluded. Financial and booking records retain their business workflow protections.</p>
    {notice && <p className="action-success" role="status">{notice}</p>}
    {error && <p role="alert">{error.message}{error.requestId && <> Request: {error.requestId}</>}</p>}
    {loading ? <p role="status">Loading workspace records…</p> : records && <>
      <div className="workspace-table-scroll" role="region" aria-label="Workspace records table" tabIndex={0}><table className="workspace-table"><caption>{modules.find(([id]) => id === resource)?.[1]} in this workspace</caption><thead><tr>{columns.map(c => <th key={c} scope="col">{label(c)}</th>)}<th scope="col">Actions</th></tr></thead><tbody>
        {records.items.map(row => <tr key={String(row.id)}>{columns.map(c => <td key={c} className={c.endsWith("id") ? "mono" : ""}>{c === "status" || c === "lifecycle_status" || c === "readiness" ? <StatusBadge value={String(row[c])} /> : cellValue(c,row)}</td>)}<td><div className="workspace-row-actions"><button type="button" disabled={opening || detail !== null || preview !== null} onClick={() => void open(String(row.id))}>{access.mode === "repair" && records.editable.length ? "Inspect / correct" : "Inspect"}</button>{access.mode === "repair" && records.deletable && <button className="text-danger" type="button" disabled={opening || detail !== null || preview !== null} onClick={() => void open(String(row.id), true)}>Delete permanently…</button>}</div></td></tr>)}
      </tbody></table></div>
      {records.items.length === 0 && <p>No records match in this workspace.</p>}
      <div className="workspace-pagination"><button className="button button-secondary" type="button" disabled={page === 0 || loading || detail !== null || preview !== null} onClick={() => setPage(p => p - 1)}>Previous records</button><span>Page {page + 1}</span><button className="button button-secondary" type="button" disabled={!records.next_cursor || loading || detail !== null || preview !== null} onClick={() => { setCursors(c => [...c.slice(0, page + 1), records.next_cursor]); setPage(p => p + 1); }}>Next records</button></div>
    </>}
    {opening && <p role="status">Inspecting record…</p>}
    {detail && <Correction key={`${resource}:${detail.id}`} detail={detail} repair={access.mode === "repair"} path={`${base}/records/${resource}/${detail.id}/correct`} token={token} onClose={() => setDetail(null)} onComplete={completed} />}
    {preview && <PermanentDelete key={preview.fingerprint} preview={preview} path={`${base}/clothing/${preview.id}/delete`} token={token} onClose={() => setPreview(null)} onComplete={completed} />}
  </div>;
}

function Correction({ detail, repair, path, token, onClose, onComplete }: { detail: Detail; repair: boolean; path: string; token: () => Promise<string>; onClose: () => void; onComplete: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(detail.editable.map(k => [k, detail.data[k] === null ? "" : String(detail.data[k])])));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(new MutationGuard());
  const changes = Object.fromEntries(detail.editable.filter(k => values[k] !== (detail.data[k] === null ? "" : String(detail.data[k]))).map(k => [k, k === "display_order" ? Number(values[k]) : values[k].trim() || null]));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (guard.current.isPending || !Object.keys(changes).length || reason.trim().length < 3) return;
    setPending(true); setError("");
    try { if (await guard.current.run("correct", { fingerprint: detail.fingerprint, changes, reason: reason.trim() }, async idempotencyKey => apiRequest(path, { method: "POST", body: { fingerprint: detail.fingerprint, changes, reason: reason.trim() }, token: await token(), idempotencyKey }))) onComplete("Correction saved. Your operator account and changed fields were recorded."); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The correction failed."); }
    finally { setPending(false); }
  };
  return <section className="workspace-edit" aria-label="Inspect workspace record"><h4>Record {detail.id}</h4>
    <dl className="client-facts">{Object.entries(detail.data).map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd>{show(v)}</dd></div>)}</dl>
    {repair && detail.editable.length > 0 && <form className="workspace-correction" onSubmit={submit}>
      <h4>Correct an encoding mistake</h4>{detail.editable.map(k => <label key={k}>{label(k)}<input type={k === "display_order" ? "number" : "text"} min={k === "display_order" ? 0 : undefined} required={["name","code","sku","asset_code"].includes(k)} maxLength={k === "description" ? 5000 : k === "name" ? 200 : k === "size_label" ? 40 : k === "color_label" ? 80 : 120} value={values[k]} disabled={pending} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} /></label>)}
      <label>Correction reason<input required minLength={3} maxLength={500} value={reason} disabled={pending} onChange={e => setReason(e.target.value)} /></label>
      {error && <p role="alert">{error} Close and inspect the current record if it changed.</p>}
      <button className="button button-primary" type="submit" disabled={pending || !Object.keys(changes).length || reason.trim().length < 3}>{pending ? "Saving correction…" : "Save correction"}</button>
    </form>}
    <button className="text-button" type="button" disabled={pending} onClick={onClose}>Close record</button>
  </section>;
}

function PermanentDelete({ preview, path, token, onClose, onComplete }: { preview: Preview; path: string; token: () => Promise<string>; onClose: () => void; onComplete: (message: string) => void }) {
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [reason, setReason] = useState(""); const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const guard = useRef(new MutationGuard());
  const valid = preview.can_delete && name === preview.name && code === preview.code && reason.trim().length >= 3 && acknowledged;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (guard.current.isPending || !valid) return;
    const body = { fingerprint: preview.fingerprint, confirm_name: name, confirm_id: preview.id, acknowledge: "PERMANENTLY DELETE", reason: reason.trim() };
    setPending(true); setError("");
    try { if (await guard.current.run("delete", body, async idempotencyKey => apiRequest(path, { method: "POST", body, token: await token(), idempotencyKey }))) onComplete(`Clothing ${preview.code} permanently deleted. ${preview.variants} variants and ${preview.assets} stock records removed; photo cleanup queued.`); }
    catch (e) { setError(e instanceof ApiError ? e.message : "The deletion failed."); }
    finally { setPending(false); }
  };
  return <section className="workspace-delete" aria-label="Permanent clothing deletion"><h4>Permanently delete {preview.name}?</h4><p>Code {preview.code} · ID <span className="mono">{preview.id}</span></p><p>This removes the clothing, {preview.variants} variants, {preview.assets} physical stock records and {preview.images} image links. Storefront featured links are removed. Storage cleanup is queued and respects retention and shared references. This cannot be undone.</p>
    <h4>Dependency check</h4><ul>{Object.entries(preview.blockers).map(([k, v]) => <li key={k}>{label(k)}: {v}</li>)}</ul>
    {!preview.can_delete ? <p role="alert">Deletion is blocked by linked operational history. Resolve these dependencies through their business workflows first.</p> : <form className="workspace-delete-form" onSubmit={submit}>
      <label>Type the clothing name<input value={name} disabled={pending} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label>Type the clothing code<input value={code} disabled={pending} onChange={e => setCode(e.target.value)} autoComplete="off" /></label>
      <label>Deletion reason<input required minLength={3} maxLength={500} value={reason} disabled={pending} onChange={e => setReason(e.target.value)} /></label>
      <label className="workspace-acknowledge"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={e => setAcknowledged(e.target.checked)} />I understand this permanently deletes this clothing and its unused inventory.</label>
      {error && <p role="alert">{error} Cancel and run the dependency check again if the record changed.</p>}
      <button className="button button-danger" type="submit" disabled={pending || !valid}>{pending ? "Deleting permanently…" : "Permanently delete clothing"}</button>
    </form>}
    <button className="text-button" type="button" disabled={pending} onClick={onClose}>Cancel deletion</button>
  </section>;
}
