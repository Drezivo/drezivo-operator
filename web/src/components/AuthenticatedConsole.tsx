"use client";

import { RedirectToSignIn, OrganizationList, OrganizationSwitcher } from "@clerk/nextjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowClockwise, Buildings, ChartLineUp, CheckCircle, CircleNotch, ClockCounterClockwise, Command, CreditCard, Gear, House, List, MagnifyingGlass, QrCode, ShieldCheck, SignOut, SquaresFour, Storefront, WarningCircle, X } from "@phosphor-icons/react";
import { ApiError, apiRequest, isSubscriptionPage, PageData, resourcePaths, resourceRequest, SubscriptionPage, withCursor } from "@/lib/api";
import { analyticsPath, parseAnalyticsResponse } from "@/lib/analytics";
import { resources, ResourceId, resourceHelp, visibleResources } from "@/lib/resources";
import { MutationGuard } from "@/lib/mutations";
import { getTokenWithTimeout } from "@/lib/token";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "./StatePanels";
import { OverviewPanel } from "./OverviewPanel";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ClientsPanel, type ClientsNavigation } from "./ClientsPanel";
import { PaymentMethodsPanel } from "./PaymentMethodsPanel";
import { PaymentsPanel } from "./PaymentReview";
import { formatManila, CLIENT_FILTERS, DEFAULT_CLIENT_FILTER, clientPaths } from "@/lib/clients";
import { platformPaymentPaths } from "@/lib/platform-payments";
import { useCachedLoad, clearViewCache, prefetchViews } from "@/lib/view-cache";
import { PaginationControls } from "./PaginationControls";
import { BrandMark } from "./BrandMark";
import { StatusBadge } from "./StatusBadge";
import { AuditPanel } from './AuditPanel';
import { SupportAccessPanel } from './SupportAccessPanel';
import { BusinessSelect } from './BusinessSelect';
import { SubscriptionsPanel } from './SubscriptionsPanel';
import { useOperatorAuth, isLocalOperator } from '@/lib/local-auth';
import { ThemeToggle } from "./ThemeToggle";

type LoadState = { status: "loading"; key: string | null } | { status: "ready"; key: string; data: unknown; requestId: string } | { status: "error"; key: string; error: ApiError };
type TableAction = { key: string; label: string; path: string; requiresReason?: boolean; body?: unknown };

function dependencyForResource(resource: ResourceId): "Business API" | "Clerk operator directory" | undefined {
  if (resource === "operators") return "Clerk operator directory";
  if (["overview", "businesses", "subscriptions", "entitlements", "jobs", "notifications"].includes(resource)) return "Business API";
  return undefined;
}

// One icon per entry in `resources`, in the same order.
const icons = [House, ChartLineUp, Storefront, Buildings, ChartLineUp, ShieldCheck, ClockCounterClockwise, Gear, List, Command, CheckCircle, ShieldCheck, CreditCard, QrCode];

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requireSessionToken(token: string | null): string {
  if (!token) throw new ApiError("The operator session could not be verified.", "unauthorized");
  return token;
}

function DataTable({ token, data, resource, onAction, pending, actionError, actionNotice, clearActionError, clearActionNotice, onKeepSidebarScroll, pageNumber, hasPrevious, onPrevious, onNext }: { token: () => Promise<string>; data: unknown; resource: ResourceId; onAction: (row: Record<string, unknown>, action: TableAction) => Promise<boolean>; pending: string | null; actionError: ApiError | null; actionNotice: { message: string; requestId: string } | null; clearActionError: () => void; clearActionNotice: () => void; onKeepSidebarScroll: () => void; pageNumber: number; hasPrevious: boolean; onPrevious: () => void; onNext: (cursor: string) => void }) {
  const [selectedAction, setSelectedAction] = useState<{ row: Record<string, unknown>; action: TableAction } | null>(null);
  const [reason, setReason] = useState("");
  const [businesses] = useCachedLoad<{items:Array<{tenant_id:string;name:string}>}>(clientPaths.list, token);
  const businessNames = businesses.status === 'ready' && Array.isArray(businesses.data.items) ? businesses.data.items : [];
  const columnLabels: Record<string,string> = {tenant_id:'Business',event_type:'Job',display_name:'Operator',last_activity_at:'Latest activity',max_attempts:'Retry limit'};
  const page = data as PageData | Array<Record<string, unknown>> | Record<string, unknown>;
  const rows = Array.isArray(page) ? page : Array.isArray((page as PageData)?.items) ? (page as PageData).items : page && typeof page === "object" ? [page as Record<string, unknown>] : [];
  const nextCursor = !Array.isArray(page) && typeof (page as PageData).next_cursor === "string" ? (page as PageData).next_cursor as string : null;
  const pagination = <PaginationControls pageNumber={pageNumber} hasPrevious={hasPrevious} nextCursor={nextCursor} onPrevious={onPrevious} onNext={onNext} />;
  if (!Array.isArray(rows) || rows.length === 0) return <>{actionNotice && <p className="action-success" role="status">{actionNotice.message}<RequestId requestId={actionNotice.requestId} /></p>}{actionError && <StatePanel error={actionError} dependency="Business API" onRetry={() => (document.getElementById("retry-action-form") as HTMLFormElement | null)?.requestSubmit()} />}<EmptyPanel />{pagination}</>;
  const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !["metadata", "permissions", "capabilities", "raw_payload"].includes(key)).slice(0, 7);
  const preferredColumns: Partial<Record<ResourceId,string[]>> = {
    operators:['display_name','role','status','last_activity_at'],
    jobs:['event_type','tenant_id','status','attempts','max_attempts','available_at'],
    notifications:['tenant_id','channel','status','template_version','accepted_at','delivered_at'],
  };
  const columns = preferredColumns[resource]?.filter(column=>rows.some(row=>column in row)) ?? allColumns;
  const actionFor = (row: Record<string, unknown>): TableAction | null => {
    const id = String(row.id || row.job_id || row.delivery_id || row.grant_id || "");
    const status = String(row.status || row.state || "").toLowerCase();
    if (resource === "jobs" && id && status === "dead" && row.can_retry === true) return { key: `jobs:${id}:retry`, label: "Retry job", path: `/jobs/${encodeURIComponent(id)}/retry`, requiresReason: true };
    if (resource === "notifications" && id && status === "failed" && row.can_retry === true) return { key: `notifications:${id}:retry`, label: "Retry delivery", path: `/notifications/${encodeURIComponent(id)}/retry`, requiresReason: true };
    return null;
  };
  return <>{actionNotice && <p className="action-success" role="status">{actionNotice.message}<RequestId requestId={actionNotice.requestId} /></p>}{actionError && <StatePanel error={actionError} dependency="Business API" onRetry={() => (document.getElementById("retry-action-form") as HTMLFormElement | null)?.requestSubmit()} />}<div className="table-wrap"><table><thead><tr>{columns.map((col) => <th key={col}>{columnLabels[col]??formatLabel(col)}</th>)}{["jobs", "notifications", "businesses", "operators"].includes(resource) && <th>Action</th>}</tr></thead><tbody>{rows.map((row, index) => {
    const action = actionFor(row);
    const tenantId = String(row.tenant_id || row.id || "");
    const isSelected = selectedAction?.action.key === action?.key;
    return <tr key={String(row.id || row.job_id || row.delivery_id || row.grant_id || row.operator_id || row.tenant_id || `row-${index}`)}>{columns.map((col) => <td key={col}>{col === "tenant_id" ? <Link href={`/?view=clients&client=${String(row[col])}`} scroll={false} onClick={onKeepSidebarScroll}>{businessNames.find(b=>b.tenant_id===row[col])?.name??'Business record'}</Link> : col === "event_type" ? formatLabel(String(row[col]).replaceAll('.', ' ')) : resource === "operators" && col === "role" ? "Superadmin" : resource === "operators" && col === "operator_id" ? <Link href={`/?view=audit&actor=${encodeURIComponent(`operator:${String(row[col])}`)}`} scroll={false} onClick={onKeepSidebarScroll}>{String(row[col])}</Link> : renderCell(row[col], col)}</td>)}{["jobs", "notifications", "businesses", "operators"].includes(resource) && <td>{resource === "operators" ? <Link className="table-action" href={`/?view=audit&actor=${encodeURIComponent(`operator:${String(row.operator_id)}`)}`} scroll={false} onClick={onKeepSidebarScroll}>View activity</Link> : resource === "businesses" && tenantId ? <Link className="table-action" href={`/?view=businesses&businessId=${encodeURIComponent(tenantId)}`} scroll={false} onClick={onKeepSidebarScroll}>View details</Link> : action && (isSelected ? <form id="retry-action-form" className="retry-form" onSubmit={async (event) => { event.preventDefault(); if (!reason.trim() || pending !== null) return; const succeeded = await onAction(row, { ...action, body: { reason: reason.trim() } }); if (succeeded) { setSelectedAction(null); setReason(""); } }}><label>Reason for retry<textarea required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending !== null} /></label><span><button type="button" className="text-button" disabled={pending !== null} onClick={() => { setSelectedAction(null); setReason(""); clearActionError(); clearActionNotice(); }}>Cancel</button><button className="table-action" type="submit" disabled={pending !== null || !reason.trim()}>{pending === action.key ? "Sending..." : "Confirm retry"}</button></span></form> : <button className="table-action" disabled={pending !== null} onClick={() => { clearActionError(); clearActionNotice(); setSelectedAction({ row, action }); setReason(""); }}>{action.label}</button>)}</td>}</tr>;
      })}</tbody></table></div>{pagination}</>;
}

function renderCell(value: unknown, column: string): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="muted">-</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <span className="muted">Structured value</span>;
  if (typeof value === "string" && ["status", "state"].includes(column.toLowerCase())) return <StatusBadge value={value} />;
  if (typeof value === "string" && /^\d{4}-\d\d-\d\d/.test(value)) return formatManila(value, true);
  return String(value);
}

function EntitlementsPanel({ data }: { data: unknown }) {
  const capabilities = (data as { capabilities?: Array<{ capability: string; enabled: boolean; limit_value: number | null }> })?.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) return <EmptyPanel title="No capabilities returned" body="The API returned no entitlement capabilities for this business." />;
  return <section className="capability-panel" aria-label="Business capabilities"><h2>Capabilities</h2><div className="table-wrap"><table><thead><tr><th>Capability</th><th>Status</th><th>Limit value</th></tr></thead><tbody>{capabilities.map((item) => <tr key={item.capability}><td>{formatLabel(item.capability.replaceAll(".", " ").replaceAll(":", " "))}<details className="technical-details"><summary>Capability code</summary>{item.capability}</details></td><td>{!item.enabled || item.limit_value === 0 ? "Not included" : "Included"}</td><td>{item.capability.endsWith(".enabled") || item.capability.startsWith("storefront_theme.") ? "-" : item.limit_value ?? "Not set"}</td></tr>)}</tbody></table></div></section>;
}

export function AuthenticatedConsole() {
  const { isLoaded, isSignedIn, getToken, signOut, userId, orgId, sessionId } = useOperatorAuth();
  const [sessionAuditError, setSessionAuditError] = useState<ApiError|null>(null);
  const [signingOut,setSigningOut] = useState(false);
  const signOutGuard = useRef(new MutationGuard());
  const reportSession = useCallback(async (event:"started"|"ended", key:string) => {
    const token = await getTokenWithTimeout(getToken);
    if (!token) throw new ApiError("The operator session could not be verified.","unauthorized");
    return apiRequest("/session/events",{token,method:"POST",body:{event},idempotencyKey:key});
  },[getToken]);
  const endSession = async () => {
    if(signOutGuard.current.isPending)return;
    setSigningOut(true);setSessionAuditError(null);
    try{await signOutGuard.current.run("session-end",{event:"ended"},async key=>{
      if(sessionId)await reportSession("ended",key);
      clearViewCache();await signOut();
    });}catch(error){setSessionAuditError(error instanceof ApiError?error:new ApiError("Sign-out could not be completed. Try again.","unavailable"));}finally{setSigningOut(false);}
  };
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
  const clientsFilter = CLIENT_FILTERS.find((value) => value === clientsFilterParam) ?? DEFAULT_CLIENT_FILTER;
  const navigateClients = useCallback((next: ClientsNavigation) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "clients");
    if (next.client !== undefined || next.tab) params.delete("workspaceGrant");
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
  const [state, setState] = useState<LoadState>({ status: "loading", key: null });
  const [refreshPending, setRefreshPending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionNotice, setActionNotice] = useState<{ message: string; requestId: string } | null>(null);
  const mutationGuard = useRef(new MutationGuard());
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const sidebarScrollTopRef = useRef(0);
  const pendingSidebarScrollTopRef = useRef<number | null>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const [selectedBusiness, setSelectedBusiness] = useState("");
  const selectorToken = useCallback(async () => requireSessionToken(await getTokenWithTimeout(getToken)), [getToken]);
  const basePath = useMemo(() => {
    if (unsupportedView) return null;
    if (active.id === "support") return null;
    if (active.id === "audit") return null;
    if (active.id === "entitlements") return selectedBusiness ? `/businesses/${encodeURIComponent(selectedBusiness)}/entitlements` : null;
    if (active.id === "grants") return null;
    if (active.id === "clients" || active.id === "payments" || active.id === "payment-methods") return null;
    if (active.id === "businesses" && businessId) return `/businesses/${encodeURIComponent(businessId)}`;
    if (active.id === "analytics") return analyticsPath(analyticsMonths);
    return resourcePaths[active.id];
  }, [active.id, selectedBusiness, businessId, unsupportedView, analyticsMonths]);
  const [cursorState, setCursorState] = useState<{ basePath: string | null; cursors: Array<string | null>; index: number }>({ basePath: null, cursors: [null], index: 0 });
  const activeCursorState = cursorState.basePath === basePath ? cursorState : { basePath, cursors: [null], index: 0 };
  const currentCursor = activeCursorState.cursors[activeCursorState.index] ?? null;
  const path = basePath ? withCursor(basePath, currentCursor) : null;
  const stateKey = path ? `${viewKey}:${path}` : null;
  const viewState: LoadState = state.key === stateKey ? state : { status: "loading", key: stateKey };
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
    const requestedStateKey = `${requestedViewKey}:${requestedPath}`;
    const isCurrentRequest = () => requestSequence === loadSequenceRef.current
      && currentViewKeyRef.current === requestedViewKey
      && currentPath.current === requestedPath
      && !signal?.aborted;
    if (isCurrentRequest()) setState({ status: "loading", key: requestedStateKey });
    setActionError(null);
    try {
      const token = await getTokenWithTimeout(getToken, signal);
      if (!isCurrentRequest()) return;
      if (active.id === "support" || active.id === "grants" || active.id === "clients" || active.id === "payments" || active.id === "payment-methods") return;
      const result = await resourceRequest(active.id, path, { token: requireSessionToken(token), signal });
      let data = result.data;
      if (active.id === "analytics") {
        try { data = parseAnalyticsResponse(result.data); }
        catch (error) { throw new ApiError(error instanceof Error ? error.message : "The operator API returned invalid analytics.", "invalid_response"); }
      }
      if (active.id === "subscriptions" && !isSubscriptionPage(result.data)) {
        throw new ApiError("The Operator API returned invalid subscriptions data.", "invalid_response", undefined, "INVALID_RESPONSE", result.requestId);
      }
      if (isCurrentRequest()) setState({ status: "ready", key: requestedStateKey, data, requestId: result.requestId });
    } catch (error) {
      if (!isCurrentRequest() || (error instanceof DOMException && error.name === "AbortError")) return;
      setState({ status: "error", key: requestedStateKey, error: error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http") });
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

  // Cached view data belongs to one operator in one organization; drop it when either changes.
  useEffect(() => { clearViewCache(); }, [userId, orgId]);

  // After the first view settles, warm the other enabled lists so switching to them is instant.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !orgId) return;
    const warmable: Partial<Record<ResourceId, string>> = {
      clients: clientPaths.list,
      payments: clientPaths.payments("pending"),
      "payment-methods": platformPaymentPaths.list,
    };
    const paths = enabledViews.map((view) => warmable[view.id]).filter((path): path is string => Boolean(path));
    const timer = window.setTimeout(() => prefetchViews(paths, async () => {
      const token = await getTokenWithTimeout(getToken);
      if (!token) throw new ApiError("The operator session could not be verified.", "unauthorized");
      return token;
    }), 600);
    return () => window.clearTimeout(timer);
  }, [enabledViews, getToken, isLoaded, isSignedIn, orgId]);

  if (!isLoaded) return <main className="setup-screen"><LoadingPanel /></main>;
  if (!isSignedIn) return <RedirectToSignIn />;
  if (!orgId) return <main className="organization-screen"><div className="organization-card"><BrandMark /><p className="eyebrow">Organization context required</p><h1>Select Internal Operator</h1><p>The operator API requires an active Clerk organization on every request. Choose the dedicated Internal Operator organization to continue. The API still checks membership and permissions before granting access.</p><OrganizationList hidePersonal afterSelectOrganizationUrl="/" /></div></main>;

  const groups = [...new Set(enabledViews.map((item) => item.group))];
  const tabViews = enabledViews.slice(0, 4);
  const tabIndex = sidebarOpen ? -1 : tabViews.findIndex((item) => item.id === activeViewId);
  const filteredResources = enabledViews.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to content</a>{sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={closeNavigation} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && sidebarOpen) closeNavigation(); }}><div className="brand"><BrandMark /><span><span className="brand-name">Drezivo</span><span className="brand-secondary">Operator</span></span><button ref={mobileCloseRef} className="icon-button mobile-close" aria-label="Close navigation" onClick={closeNavigation}><X size={18} /></button></div>
      <div className="workspace-switch"><span className="workspace-label">Workspace</span><div className="organization-control">{isLocalOperator ? <span>Local operator organization</span> : <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" afterLeaveOrganizationUrl="/" appearance={{ elements: { rootBox: { width: "100%" }, organizationSwitcherTrigger: { width: "100%", justifyContent: "space-between", padding: "8px 10px", borderRadius: "7px" } } }} />}</div></div>
      <div className="search-box"><MagnifyingGlass size={15} /><input aria-label="Filter navigation" placeholder="Find a view" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Clear navigation filter" onClick={() => setSearch("")}>Clear</button>}</div>
      <nav ref={sidebarNavRef} aria-label="Main navigation" onScroll={(event) => { if (pendingSidebarScrollTopRef.current === null) sidebarScrollTopRef.current = event.currentTarget.scrollTop; }}>{filteredResources.length === 0 ? <p className="nav-empty" role="status">No views match “{search.trim()}”.</p> : groups.map((group) => { const groupResources = filteredResources.filter((resource) => resource.group === group); return groupResources.length > 0 && <div className="nav-group" key={group}><span className="nav-label">{group}</span>{groupResources.map((item) => { const index = resources.indexOf(item); const Icon = icons[index]; return <Link key={item.id} className={`nav-item ${activeViewId === item.id ? "active" : ""}`} href={item.path} scroll={false} aria-current={activeViewId === item.id ? "page" : undefined} onClick={() => { rememberSidebarScroll(); setSidebarOpen(false); }}><Icon size={17} weight={activeViewId === item.id ? "fill" : "regular"} /><span>{item.label}</span></Link>; })}</div>; })}</nav>
      <div className="sidebar-bottom"><div className="api-status"><span className="status-dot status-neutral" /><span><strong>API connection</strong><small>Checked per request</small></span></div><button className="profile-button" disabled={signingOut} aria-busy={signingOut} onClick={() => void endSession()}><span className="avatar">{(userId || "OP").slice(0, 2).toUpperCase()}</span><span><strong>Superadmin session</strong><small>{signingOut?"Signing out...":"Sign out"}</small></span><SignOut size={16} /></button></div>
    </aside>
    <main id="main-content" className="main-area"><header className="topbar"><div className="crumb"><button ref={mobileMenuRef} className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><List size={18} /></button><span>Operator console</span><span className="crumb-separator">/</span><strong>{unsupportedView ? "Unsupported view" : active.label}</strong></div><div className="topbar-right"><span className={`environment-label ${isLocalOperator?"local-environment":""}`}>{isLocalOperator?"Local Docker / synthetic data":"Internal"}</span><ThemeToggle />{path && <button className="icon-button refresh-button" aria-label={refreshPending ? "Refreshing data" : "Refresh data"} aria-busy={refreshPending} disabled={refreshPending || !path} onClick={() => { void refresh(); }}><ArrowClockwise className={refreshPending ? "spin" : undefined} size={17} /></button>}</div></header>
        <div className="page-content">{sessionAuditError&&<div className="session-audit-error" role="alert">{sessionAuditError.message} Your session remains open; use Sign out to retry.</div>}<div className="page-heading"><div><p className="eyebrow">{unsupportedView ? "Navigation" : active.group}</p><h1 ref={pageHeadingRef} tabIndex={-1}>{unsupportedView ? "Unsupported view" : active.id === "businesses" && businessId ? "Business details" : active.id === "clients" && clientId ? "Business" : active.label}</h1><p className="page-description">{unsupportedView ? `The requested view “${requestedView}” is not supported. Choose a view from the navigation.` : active.id === "businesses" && businessId ? `Business record for ${businessId} returned by the operator API.` : active.id === "clients" && clientId ? "Account, people and actions for one client business." : resourceHelp[active.id]}</p></div>{active.id === "entitlements" && !unsupportedView && <div className="business-picker"><BusinessSelect token={selectorToken} value={selectedBusiness} onChange={setSelectedBusiness} required /></div>}</div>
        {unsupportedView ? <div className="blocked-panel" role="alert"><span className="blocked-mark"><WarningCircle size={21} /></span><div><span className="eyebrow">Request rejected</span><h2>This console view is not supported</h2><p>Select a supported view from the navigation. No operator API request was made.</p></div></div>
          : active.id === "audit" || active.id === "support" ? <AuditPanel key={`${active.id}:${searchParams.get("actor")??""}`} getToken={getToken} actor={searchParams.get("actor")??""} operatorOnly={active.id === "support"} />
          : active.id === "grants" ? <SupportAccessPanel getToken={getToken} currentOperatorId={userId} onKeepSidebarScroll={rememberSidebarScroll} />
          : active.id === "clients" ? <ClientsPanel workspaceGrantId={searchParams.get("workspaceGrant")} getToken={getToken} clientId={clientId} tab={clientsTab} filter={clientsFilter} onNavigate={navigateClients} />
          : active.id === "payments" ? <PaymentsPanel getToken={getToken} onOpenBusiness={(id) => navigateClients({ client: id })} />
          : active.id === "payment-methods" ? <PaymentMethodsPanel getToken={getToken} />
          : active.id === "entitlements" && !selectedBusiness ? <EmptyPanel title="Choose a business" body="Select a business by name above to review its plan and included capabilities." />
            : viewState.status === "loading" ? <LoadingPanel />
              : viewState.status === "error" ? <StatePanel error={viewState.error} dependency={dependencyForResource(active.id)} onRetry={() => void load()} />
                : active.id === "overview" ? <OverviewPanel data={viewState.data} onKeepSidebarScroll={rememberSidebarScroll} />
                  : active.id === "analytics" ? <AnalyticsPanel data={viewState.data as import("@/lib/analytics").AnalyticsResponse} months={analyticsMonths} onMonthsChange={(months) => { rememberSidebarScroll(); const params = new URLSearchParams(window.location.search); params.set("view", "analytics"); params.set("months", String(months)); window.history.pushState(null, "", `/?${params.toString()}`); }} />
                  : active.id === "subscriptions" ? <SubscriptionsPanel data={viewState.data as SubscriptionPage} pageNumber={activeCursorState.index+1} hasPrevious={activeCursorState.index>0} onPrevious={previousPage} onNext={nextPage} />
                  : active.id === "entitlements" ? <EntitlementsPanel data={viewState.data} />
                  : <DataTable token={selectorToken} data={viewState.data} resource={active.id} onAction={act} pending={pending} actionError={actionError} actionNotice={actionNotice} clearActionError={() => setActionError(null)} clearActionNotice={() => setActionNotice(null)} onKeepSidebarScroll={rememberSidebarScroll} pageNumber={activeCursorState.index + 1} hasPrevious={activeCursorState.index > 0} onPrevious={previousPage} onNext={nextPage} />}
        {viewState.status === "ready" && path && <div className="loaded-request"><RequestId requestId={viewState.requestId} /></div>}
        <footer className="page-footer"><span>Private operator workspace</span><span>Access checks are enforced by the API.</span></footer>
      </div>
      {/* Phones: thumb-reach tabs for the first four views; Menu opens the full navigation drawer (the hamburger still does too). */}
      <nav className="tab-bar" aria-label="Quick navigation">
        <ul style={{ "--tab-count": Math.min(enabledViews.length, 4) + 1, "--tab-active": tabIndex === -1 ? Math.min(enabledViews.length, 4) : tabIndex } as React.CSSProperties}>
          {tabViews.map((item, index) => { const Icon = icons[resources.indexOf(item)]; const current = index === tabIndex; return <li key={item.id}><Link href={item.path} scroll={false} className={`tab-item ${current ? "active" : ""}`} aria-current={current ? "page" : undefined} onClick={rememberSidebarScroll}><span className="tab-icon"><Icon size={21} weight={current ? "fill" : "regular"} /></span><span>{item.label}</span></Link></li>; })}
          <li><button type="button" className={`tab-item ${tabIndex === -1 || sidebarOpen ? "active" : ""}`} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><span className="tab-icon"><SquaresFour size={21} weight={tabIndex === -1 || sidebarOpen ? "fill" : "regular"} /></span><span>Menu</span></button></li>
        </ul>
      </nav>
    </main>
  </div>;
}
