"use client";

import { useAuth, RedirectToSignIn, OrganizationList, OrganizationSwitcher } from "@clerk/nextjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowClockwise, Buildings, ChartLineUp, CheckCircle, CircleNotch, ClockCounterClockwise, Command, Gear, House, List, MagnifyingGlass, ShieldCheck, SignOut, Storefront, WarningCircle, X } from "@phosphor-icons/react";
import { ApiError, apiRequest, PageData, resourcePaths, resourceRequest, withCursor } from "@/lib/api";
import { analyticsPath, parseAnalyticsResponse } from "@/lib/analytics";
import { resources, ResourceId, resourceHelp, visibleResources } from "@/lib/resources";
import { MutationGuard } from "@/lib/mutations";
import { getTokenWithTimeout } from "@/lib/token";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { OverviewPanel } from "./OverviewPanel";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ClientsPanel, type ClientsNavigation } from "./ClientsPanel";
import { PaginationControls } from "./PaginationControls";
import { BrandMark } from "./BrandMark";
import { StatusBadge } from "./StatusBadge";

type LoadState = { status: "loading" } | { status: "ready"; data: unknown; requestId: string } | { status: "error"; error: ApiError };
type TableAction = { key: string; label: string; path: string; requiresReason?: boolean; body?: unknown };

function dependencyForResource(resource: ResourceId): "Business API" | "Clerk operator directory" | undefined {
  if (resource === "operators") return "Clerk operator directory";
  if (["overview", "businesses", "subscriptions", "entitlements", "jobs", "notifications"].includes(resource)) return "Business API";
  return undefined;
}

const icons = [House, ChartLineUp, Storefront, Buildings, ChartLineUp, ShieldCheck, ClockCounterClockwise, Gear, List, Command, CheckCircle, ShieldCheck];

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requireSessionToken(token: string | null): string {
  if (!token) throw new ApiError("The operator session could not be verified.", "unauthorized");
  return token;
}

function DataTable({ data, resource, onAction, pending, actionError, actionNotice, clearActionError, clearActionNotice, onKeepSidebarScroll, pageNumber, hasPrevious, onPrevious, onNext }: { data: unknown; resource: ResourceId; onAction: (row: Record<string, unknown>, action: TableAction) => Promise<boolean>; pending: string | null; actionError: ApiError | null; actionNotice: { message: string; requestId: string } | null; clearActionError: () => void; clearActionNotice: () => void; onKeepSidebarScroll: () => void; pageNumber: number; hasPrevious: boolean; onPrevious: () => void; onNext: (cursor: string) => void }) {
  const [selectedAction, setSelectedAction] = useState<{ row: Record<string, unknown>; action: TableAction } | null>(null);
  const [reason, setReason] = useState("");
  const page = data as PageData | Array<Record<string, unknown>> | Record<string, unknown>;
  const rows = Array.isArray(page) ? page : Array.isArray((page as PageData)?.items) ? (page as PageData).items : page && typeof page === "object" ? [page as Record<string, unknown>] : [];
  const nextCursor = !Array.isArray(page) && typeof (page as PageData).next_cursor === "string" ? (page as PageData).next_cursor as string : null;
  const pagination = <PaginationControls pageNumber={pageNumber} hasPrevious={hasPrevious} nextCursor={nextCursor} onPrevious={onPrevious} onNext={onNext} />;
  if (!Array.isArray(rows) || rows.length === 0) return <>{actionNotice && <p className="action-success" role="status">{actionNotice.message}<RequestId requestId={actionNotice.requestId} /></p>}{actionError && <StatePanel error={actionError} dependency="Business API" onRetry={() => (document.getElementById("retry-action-form") as HTMLFormElement | null)?.requestSubmit()} />}<EmptyPanel />{pagination}</>;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !["metadata", "permissions", "capabilities", "raw_payload"].includes(key)).slice(0, 7);
  const actionFor = (row: Record<string, unknown>): TableAction | null => {
    const id = String(row.id || row.job_id || row.delivery_id || row.grant_id || "");
    const status = String(row.status || row.state || "").toLowerCase();
    if (resource === "jobs" && id && ["failed", "dead", "retryable"].includes(status)) return { key: `jobs:${id}:retry`, label: "Retry job", path: `/jobs/${encodeURIComponent(id)}/retry`, requiresReason: true };
    if (resource === "notifications" && id && ["failed", "bounced", "retryable"].includes(status)) return { key: `notifications:${id}:retry`, label: "Retry delivery", path: `/notifications/${encodeURIComponent(id)}/retry`, requiresReason: true };
    return null;
  };
  return <>{actionNotice && <p className="action-success" role="status">{actionNotice.message}<RequestId requestId={actionNotice.requestId} /></p>}{actionError && <StatePanel error={actionError} dependency="Business API" onRetry={() => (document.getElementById("retry-action-form") as HTMLFormElement | null)?.requestSubmit()} />}<div className="table-wrap"><table><thead><tr>{columns.map((col) => <th key={col}>{formatLabel(col)}</th>)}{["jobs", "notifications", "businesses"].includes(resource) && <th>Action</th>}</tr></thead><tbody>{rows.map((row, index) => {
    const action = actionFor(row);
    const tenantId = String(row.tenant_id || row.id || "");
    const isSelected = selectedAction?.action.key === action?.key;
    return <tr key={String(row.id || row.tenant_id || row.created_at || index)}>{columns.map((col) => <td key={col}>{renderCell(row[col], col)}</td>)}{["jobs", "notifications", "businesses"].includes(resource) && <td>{resource === "businesses" && tenantId ? <Link className="table-action" href={`/?view=businesses&businessId=${encodeURIComponent(tenantId)}`} scroll={false} onClick={onKeepSidebarScroll}>View details</Link> : action && (isSelected ? <form id="retry-action-form" className="retry-form" onSubmit={async (event) => { event.preventDefault(); if (!reason.trim() || pending !== null) return; const succeeded = await onAction(row, { ...action, body: { reason: reason.trim() } }); if (succeeded) { setSelectedAction(null); setReason(""); } }}><label>Reason for retry<textarea required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending !== null} /></label><span><button type="button" className="text-button" disabled={pending !== null} onClick={() => { setSelectedAction(null); setReason(""); clearActionError(); clearActionNotice(); }}>Cancel</button><button className="table-action" type="submit" disabled={pending !== null || !reason.trim()}>{pending === action.key ? "Sending..." : "Confirm retry"}</button></span></form> : <button className="table-action" disabled={pending !== null} onClick={() => { clearActionError(); clearActionNotice(); setSelectedAction({ row, action }); setReason(""); }}>{action.label}</button>)}</td>}</tr>;
      })}</tbody></table></div>{pagination}</>;
}

function renderCell(value: unknown, column: string): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="muted">-</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <span className="muted">Structured value</span>;
  if (typeof value === "string" && ["status", "state"].includes(column.toLowerCase())) return <StatusBadge value={value} />;
  if (typeof value === "string" && /^\d{4}-\d\d-\d\d/.test(value)) return new Date(value).toLocaleString();
  return String(value);
}

function EntitlementsPanel({ data }: { data: unknown }) {
  const capabilities = (data as { capabilities?: Array<{ capability: string; enabled: boolean; limit_value: number | null }> })?.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) return <EmptyPanel title="No capabilities returned" body="The API returned no entitlement capabilities for this business." />;
  return <section className="capability-panel" aria-label="Business capabilities"><h2>Capabilities</h2><div className="table-wrap"><table><thead><tr><th>Capability</th><th>Status</th><th>Limit value</th></tr></thead><tbody>{capabilities.map((item) => <tr key={item.capability}><td>{item.capability}</td><td>{item.enabled ? "Enabled" : "Disabled"}</td><td>{item.limit_value ?? "-"}</td></tr>)}</tbody></table></div></section>;
}

export function AuthenticatedConsole() {
  const { isLoaded, isSignedIn, getToken, signOut, userId, orgId } = useAuth();
  const searchParams = useSearchParams();
  const requestedViews = searchParams.getAll("view");
  const requestedView = requestedViews[0] ?? null;
  const enabledViews = useMemo(() => visibleResources(), []);
  const active = enabledViews.find((resource) => resource.id === requestedView) || enabledViews[0] || resources[0];
  const unsupportedView = requestedViews.length > 1 || (requestedView !== null && !enabledViews.some((resource) => resource.id === requestedView));
  const activeViewId = unsupportedView ? null : active.id;
  const businessId = searchParams.get("businessId") || "";
  const clientId = searchParams.get("client");
  const clientsTab = searchParams.get("tab") === "people" ? "people" : "businesses";
  const clientsFilterParam = searchParams.get("filter");
  const clientsFilter = (["attention", "trial", "unpaid", "locked", "paid", "all"] as const).find((value) => value === clientsFilterParam) ?? "attention";
  const navigateClients = useCallback((next: ClientsNavigation) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "clients");
    if (next.client !== undefined) { if (next.client) params.set("client", next.client); else params.delete("client"); }
    if (next.tab) { params.set("tab", next.tab); params.delete("client"); }
    if (next.filter) params.set("filter", next.filter);
    window.history.pushState(null, "", `/?${params.toString()}`);
    if (next.client !== undefined || next.tab) window.scrollTo({ top: 0 });
  }, []);
  const requestedMonths = Number(searchParams.get("months"));
  const analyticsMonths = [12, 24, 36, 48].includes(requestedMonths) ? requestedMonths : 48;
  const viewKey = unsupportedView ? `unsupported:${requestedViews.join(",")}` : `${active.id}:${businessId}`;
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousViewKeyRef = useRef(viewKey);
  const currentViewKeyRef = useRef(viewKey);
  currentViewKeyRef.current = viewKey;
  const loadSequenceRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const refreshPendingRef = useRef(false);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshPending, setRefreshPending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionNotice, setActionNotice] = useState<{ message: string; requestId: string } | null>(null);
  const [grantError, setGrantError] = useState<ApiError | null>(null);
  const mutationGuard = useRef(new MutationGuard());
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const sidebarScrollTopRef = useRef(0);
  const pendingSidebarScrollTopRef = useRef<number | null>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const [grantNotice, setGrantNotice] = useState<{ message: string; requestId: string } | null>(null);
  const [revokeNotice, setRevokeNotice] = useState<{ message: string; requestId: string } | null>(null);
  const [revokeError, setRevokeError] = useState<ApiError | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState("");
  const [entitlementInput, setEntitlementInput] = useState("");
  const basePath = useMemo(() => {
    if (unsupportedView) return null;
    if (active.id === "support") return null;
    if (active.id === "audit") return null;
    if (active.id === "entitlements") return selectedBusiness ? `/businesses/${encodeURIComponent(selectedBusiness)}/entitlements` : null;
    if (active.id === "grants") return null;
    if (active.id === "clients") return null;
    if (active.id === "businesses" && businessId) return `/businesses/${encodeURIComponent(businessId)}`;
    if (active.id === "analytics") return analyticsPath(analyticsMonths);
    return resourcePaths[active.id];
  }, [active.id, selectedBusiness, businessId, unsupportedView, analyticsMonths]);
  const [cursorState, setCursorState] = useState<{ basePath: string | null; cursors: Array<string | null>; index: number }>({ basePath: null, cursors: [null], index: 0 });
  const activeCursorState = cursorState.basePath === basePath ? cursorState : { basePath, cursors: [null], index: 0 };
  const currentCursor = activeCursorState.cursors[activeCursorState.index] ?? null;
  const path = basePath ? withCursor(basePath, currentCursor) : null;
  const currentPath = useRef(path);
  currentPath.current = path;

  const previousPage = () => {
    if (activeCursorState.index === 0) return;
    setCursorState({ ...activeCursorState, index: activeCursorState.index - 1 });
  };

  const nextPage = (cursor: string) => {
    const nextIndex = activeCursorState.index + 1;
    const cursors = activeCursorState.cursors.slice(0, nextIndex);
    cursors[nextIndex] = cursor;
    setCursorState({ ...activeCursorState, cursors, index: nextIndex });
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!path) return;
    const requestSequence = ++loadSequenceRef.current;
    const requestedViewKey = viewKey;
    const requestedPath = path;
    const isCurrentRequest = () => requestSequence === loadSequenceRef.current
      && currentViewKeyRef.current === requestedViewKey
      && currentPath.current === requestedPath
      && !signal?.aborted;
    if (isCurrentRequest()) setState({ status: "loading" });
    setActionError(null);
    try {
      const token = await getTokenWithTimeout(getToken, signal);
      if (!isCurrentRequest()) return;
      if (active.id === "support" || active.id === "grants" || active.id === "clients") return;
      const result = await resourceRequest(active.id, path, { token: requireSessionToken(token), signal });
      let data = result.data;
      if (active.id === "analytics") {
        try { data = parseAnalyticsResponse(result.data); }
        catch (error) { throw new ApiError(error instanceof Error ? error.message : "The operator API returned invalid analytics.", "invalid_response"); }
      }
      if (isCurrentRequest()) setState({ status: "ready", data, requestId: result.requestId });
    } catch (error) {
      if (!isCurrentRequest() || (error instanceof DOMException && error.name === "AbortError")) return;
      setState({ status: "error", error: error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http") });
    }
  }, [active.id, getToken, path, viewKey]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !orgId || !path) return;
    const controller = new AbortController();
    activeRequestControllerRef.current = controller;
    void load(controller.signal);
    return () => {
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = null;
    };
  }, [isLoaded, isSignedIn, orgId, path, load]);

  const refresh = async () => {
    if (!path || refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    setRefreshPending(true);
    activeRequestControllerRef.current?.abort();
    const controller = new AbortController();
    activeRequestControllerRef.current = controller;
    try {
      await load(controller.signal);
    } catch {
      // load normalizes request failures into view state; never leak an event-handler rejection.
    } finally {
      if (activeRequestControllerRef.current === controller) activeRequestControllerRef.current = null;
      refreshPendingRef.current = false;
      setRefreshPending(false);
    }
  };

  useEffect(() => { if (sidebarOpen) mobileCloseRef.current?.focus(); }, [sidebarOpen]);

  useLayoutEffect(() => {
    const nav = sidebarNavRef.current;
    if (!nav) return;
    const targetScrollTop = pendingSidebarScrollTopRef.current ?? sidebarScrollTopRef.current;
    nav.scrollTop = targetScrollTop;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        nav.scrollTop = targetScrollTop;
        sidebarScrollTopRef.current = targetScrollTop;
        pendingSidebarScrollTopRef.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [active.id, businessId]);

  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return;
    previousViewKeyRef.current = viewKey;
    pageHeadingRef.current?.focus();
  }, [viewKey]);

  const rememberSidebarScroll = () => {
    const scrollTop = sidebarNavRef.current?.scrollTop ?? sidebarScrollTopRef.current;
    sidebarScrollTopRef.current = scrollTop;
    pendingSidebarScrollTopRef.current = scrollTop;
  };

  const closeNavigation = () => {
    setSidebarOpen(false);
    mobileMenuRef.current?.focus();
  };

  const act = async (_row: Record<string, unknown>, action: TableAction): Promise<boolean> => {
    if (mutationGuard.current.isPending) return false;
    setPending(action.key);
    try {
      const result = await mutationGuard.current.run(action.key, action.body ?? {}, async (idempotencyKey) => {
        const token = requireSessionToken(await getTokenWithTimeout(getToken));
        return apiRequest(action.path, { token, method: "POST", body: action.body, idempotencyKey });
      });
      if (!result) return false;
      setActionError(null);
      setActionNotice({ message: "Action accepted by the API.", requestId: result.requestId });
      if (currentPath.current === path) await load();
      return true;
    } catch (error) {
      const normalized = error instanceof ApiError ? error : new ApiError("The action could not be completed.", "http");
      setActionError(normalized);
      return false;
    } finally {
      setPending(null);
    }
  };

  const createGrant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationGuard.current.isPending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const intent = "support-grant:create";
    const startsAt = new Date(String(form.get("starts_at")));
    const expiresAt = new Date(String(form.get("expires_at")));
    const payload = {
      tenant_id: String(form.get("tenant_id")).trim(),
      permission_codes: String(form.get("permission_codes")).split(",").map((value) => value.trim()).filter(Boolean),
      reason: String(form.get("reason")).trim(),
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    setPending(intent);
    setGrantNotice(null);
    setGrantError(null);
    try {
      const result = await mutationGuard.current.run(intent, payload, async (idempotencyKey) => {
        const token = requireSessionToken(await getTokenWithTimeout(getToken));
        return apiRequest("/support-grants", { token, method: "POST", body: payload, idempotencyKey });
      });
      if (!result) return;
      setGrantNotice({ message: "Request accepted by the API.", requestId: result.requestId });
      formElement.reset();
    } catch (error) {
      const normalized = error instanceof ApiError ? error : new ApiError("The request could not be completed.", "http");
      setGrantError(normalized);
    } finally {
      setPending(null);
    }
  };

  const revokeGrant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutationGuard.current.isPending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const grantId = String(form.get("grant_id")).trim();
    const intent = `support-grant:revoke:${grantId}`;
    setPending(intent);
    setRevokeNotice(null);
    setRevokeError(null);
    try {
      const result = await mutationGuard.current.run(intent, {}, async (idempotencyKey) => {
        const token = requireSessionToken(await getTokenWithTimeout(getToken));
        return apiRequest(`/support-grants/${encodeURIComponent(grantId)}/revoke`, { token, method: "POST", body: {}, idempotencyKey });
      });
      if (!result) return;
      setRevokeNotice({ message: "Revocation request accepted by the API.", requestId: result.requestId });
      formElement.reset();
    } catch (error) {
      setRevokeError(error instanceof ApiError ? error : new ApiError("The revocation request could not be completed.", "http"));
    } finally {
      setPending(null);
    }
  };

  if (!isLoaded) return <main className="setup-screen"><LoadingPanel /></main>;
  if (!isSignedIn) return <RedirectToSignIn />;
  if (!orgId) return <main className="organization-screen"><div className="organization-card"><BrandMark /><p className="eyebrow">Organization context required</p><h1>Select Internal Operator</h1><p>The operator API requires an active Clerk organization on every request. Choose the dedicated Internal Operator organization to continue. The API still checks membership and permissions before granting access.</p><OrganizationList hidePersonal afterSelectOrganizationUrl="/" /></div></main>;

  const groups = [...new Set(enabledViews.map((item) => item.group))];
  const filteredResources = enabledViews.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to content</a>{sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={closeNavigation} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && sidebarOpen) closeNavigation(); }}><div className="brand"><BrandMark /><span>Drezivo<span className="brand-secondary">Operator</span></span><button ref={mobileCloseRef} className="icon-button mobile-close" aria-label="Close navigation" onClick={closeNavigation}><X size={18} /></button></div>
      <div className="workspace-switch"><span className="workspace-label">Workspace</span><div className="organization-control"><OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" afterLeaveOrganizationUrl="/" appearance={{ elements: { rootBox: { width: "100%" }, organizationSwitcherTrigger: { width: "100%", justifyContent: "space-between", padding: "8px 10px", borderRadius: "7px" } } }} /></div></div>
      <div className="search-box"><MagnifyingGlass size={15} /><input aria-label="Filter navigation" placeholder="Find a view" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Clear navigation filter" onClick={() => setSearch("")}>Clear</button>}</div>
      <nav ref={sidebarNavRef} aria-label="Main navigation" onScroll={(event) => { if (pendingSidebarScrollTopRef.current === null) sidebarScrollTopRef.current = event.currentTarget.scrollTop; }}>{filteredResources.length === 0 ? <p className="nav-empty" role="status">No views match “{search.trim()}”.</p> : groups.map((group) => { const groupResources = filteredResources.filter((resource) => resource.group === group); return groupResources.length > 0 && <div className="nav-group" key={group}><span className="nav-label">{group}</span>{groupResources.map((item) => { const index = resources.indexOf(item); const Icon = icons[index]; return <Link key={item.id} className={`nav-item ${activeViewId === item.id ? "active" : ""}`} href={item.path} scroll={false} aria-current={activeViewId === item.id ? "page" : undefined} onClick={() => { rememberSidebarScroll(); setSidebarOpen(false); }}><Icon size={17} weight={activeViewId === item.id ? "fill" : "regular"} /><span>{item.label}</span></Link>; })}</div>; })}</nav>
      <div className="sidebar-bottom"><div className="api-status"><span className="status-dot status-neutral" /><span><strong>API connection</strong><small>Checked per request</small></span></div><button className="profile-button" onClick={() => void signOut()}><span className="avatar">{(userId || "OP").slice(0, 2).toUpperCase()}</span><span><strong>Operator session</strong><small>Sign out</small></span><SignOut size={16} /></button></div>
    </aside>
    <main id="main-content" className="main-area"><header className="topbar"><div className="crumb"><button ref={mobileMenuRef} className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><List size={18} /></button><span>Operator console</span><span className="crumb-separator">/</span><strong>{unsupportedView ? "Unsupported view" : active.label}</strong></div><div className="topbar-right"><span className="environment-label">Internal</span><button className="icon-button refresh-button" aria-label={refreshPending ? "Refreshing data" : "Refresh data"} aria-busy={refreshPending} disabled={refreshPending || !path} onClick={() => { void refresh(); }}><ArrowClockwise className={refreshPending ? "spin" : undefined} size={17} /></button></div></header>
        <div className="page-content"><div className="page-heading"><div><p className="eyebrow">{unsupportedView ? "Navigation" : active.group}</p><h1 ref={pageHeadingRef} tabIndex={-1}>{unsupportedView ? "Unsupported view" : active.id === "businesses" && businessId ? "Business details" : active.id === "clients" && clientId ? "Business" : active.label}</h1><p className="page-description">{unsupportedView ? `The requested view “${requestedView}” is not supported. Choose a view from the navigation.` : active.id === "businesses" && businessId ? `Business record for ${businessId} returned by the operator API.` : active.id === "clients" && clientId ? "Account, people and actions for one client business." : resourceHelp[active.id]}</p></div>{active.id === "entitlements" && !unsupportedView && <form className="business-picker" onSubmit={(event) => { event.preventDefault(); setSelectedBusiness(entitlementInput.trim()); }}><label htmlFor="entitlement-business-id">Business ID</label><div><input id="entitlement-business-id" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" title="Enter a valid business UUID" value={entitlementInput} onChange={(event) => setEntitlementInput(event.target.value)} placeholder="Business UUID" /><button className="button button-secondary" type="submit">Load</button></div></form>}</div>
        {unsupportedView ? <div className="blocked-panel" role="alert"><span className="blocked-mark"><WarningCircle size={21} /></span><div><span className="eyebrow">Request rejected</span><h2>This console view is not supported</h2><p>Select a supported view from the navigation. No operator API request was made.</p></div></div>
          : active.id === "audit" ? <div className="blocked-panel"><span className="blocked-mark"><WarningCircle size={21} /></span><div><span className="eyebrow">Contract review</span><h2>Audit search is not enabled</h2><p>The business and operator audit records do not yet share an approved actor, outcome, scope, and redaction contract. No records are hidden behind an empty result.</p></div></div>
          : active.id === "support" ? <div className="blocked-panel"><span className="blocked-mark"><WarningCircle size={21} /></span><div><span className="eyebrow">Backend contract blocked</span><h2>Support activity is not available yet</h2><p>The API team has blocked this route while business-wire semantics are being resolved. This console will not show guessed or incomplete activity records.</p></div></div>
          : active.id === "grants" ? <div className="grant-stack"><section className="grant-card"><div className="card-heading"><div><span className="eyebrow">Temporary access</span><h2>Create support grant</h2></div><ShieldCheck size={19} /></div><p className="grant-intro">Access requests are validated by the API. Use a specific business, permission set, reason, and access window.</p>{grantNotice && <p className="grant-success" role="status"><CheckCircle size={16} />{grantNotice.message}<RequestId requestId={grantNotice.requestId} /></p>}{grantError && <StatePanel error={grantError} dependency="Business API" onRetry={() => (document.getElementById("grant-form") as HTMLFormElement | null)?.requestSubmit()} />}<form id="grant-form" className="grant-form" onSubmit={createGrant}><label>Business tenant ID<input name="tenant_id" required maxLength={120} /></label><label>Permission codes<input name="permission_codes" required placeholder="billing.read, users.read" /></label><label className="grant-wide">Reason<textarea name="reason" required minLength={8} maxLength={500} rows={3} /></label><label>Starts at<input name="starts_at" type="datetime-local" required /></label><label>Expires at<input name="expires_at" type="datetime-local" required /></label><div className="grant-actions"><small>All values are sent to the API for authoritative validation.</small><button className="button button-primary" type="submit" disabled={pending !== null}>{pending === "support-grant:create" ? <><CircleNotch className="spin" size={15} /> Sending…</> : "Create grant"}</button></div></form></section><section className="grant-card revoke-card"><div className="card-heading"><div><span className="eyebrow">Access control</span><h2>Revoke support grant</h2></div><WarningCircle size={19} /></div><p className="grant-intro">Enter the grant ID from its original API response. The API checks access and current grant state before revoking.</p>{revokeNotice && <p className="grant-success" role="status"><CheckCircle size={16} />{revokeNotice.message}<RequestId requestId={revokeNotice.requestId} /></p>}{revokeError && <StatePanel error={revokeError} dependency="Business API" onRetry={() => (document.getElementById("revoke-form") as HTMLFormElement | null)?.requestSubmit()} />}<form id="revoke-form" className="grant-form revoke-form" onSubmit={revokeGrant}><label>Support grant ID<input name="grant_id" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}" title="Enter a valid UUID" /></label><div className="grant-actions"><small>Revocation is checked and recorded by the API.</small><button className="button button-secondary" type="submit" disabled={pending !== null}>{pending?.startsWith("support-grant:revoke:") ? <><CircleNotch className="spin" size={15} /> Sending…</> : "Revoke grant"}</button></div></form></section></div>
          : active.id === "clients" ? <ClientsPanel getToken={getToken} clientId={clientId} tab={clientsTab} filter={clientsFilter} onNavigate={navigateClients} />
          : active.id === "entitlements" && !selectedBusiness ? <EmptyPanel title="Choose a business" body="Enter a tenant ID to request its entitlements from the operator API." />
            : state.status === "loading" ? <LoadingPanel />
              : state.status === "error" ? <StatePanel error={state.error} dependency={dependencyForResource(active.id)} onRetry={() => void load()} />
                : active.id === "overview" ? <OverviewPanel data={state.data} onKeepSidebarScroll={rememberSidebarScroll} />
                  : active.id === "analytics" ? <AnalyticsPanel data={state.data as import("@/lib/analytics").AnalyticsResponse} months={analyticsMonths} onMonthsChange={(months) => { rememberSidebarScroll(); const params = new URLSearchParams(window.location.search); params.set("view", "analytics"); params.set("months", String(months)); window.history.pushState(null, "", `/?${params.toString()}`); }} />
                  : active.id === "entitlements" ? <EntitlementsPanel data={state.data} />
                  : <DataTable data={state.data} resource={active.id} onAction={act} pending={pending} actionError={actionError} actionNotice={actionNotice} clearActionError={() => setActionError(null)} clearActionNotice={() => setActionNotice(null)} onKeepSidebarScroll={rememberSidebarScroll} pageNumber={activeCursorState.index + 1} hasPrevious={activeCursorState.index > 0} onPrevious={previousPage} onNext={nextPage} />}
        {state.status === "ready" && path && <div className="loaded-request"><RequestId requestId={state.requestId} /></div>}
        <footer className="page-footer"><span>Private operator workspace</span><span>Access checks are enforced by the API.</span></footer>
      </div>
    </main>
  </div>;
}
