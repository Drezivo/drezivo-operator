"use client";
import { RedirectToSignIn, OrganizationList, OrganizationSwitcher } from "@clerk/nextjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowClockwise, Buildings, ChartLineUp, CheckCircle, ClockCounterClockwise, Command, CreditCard, Gear, House, List, MagnifyingGlass, QrCode, ShieldCheck, SignOut, SquaresFour, Storefront, X } from "@phosphor-icons/react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { resources, visibleResources, resourceForPath } from "@/shared/navigation/resources";
import { MutationGuard } from "@/shared/api/mutations";
import { getTokenWithTimeout } from "@/shared/auth/token";
import { clearViewCache, prefetchViews } from "@/shared/api/view-cache";
import { useOperatorAuth, isLocalOperator } from "@/shared/auth/local-auth";
import { BrandMark } from "@/shared/ui/BrandMark";
import { LoadingPanel } from "@/shared/ui/StatePanels";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";
import { ConsoleControlsContext, type ConsoleControls } from "./console-controls";

const icons = [House, ChartLineUp, Storefront, Buildings, ChartLineUp, ShieldCheck, ClockCounterClockwise, Gear, List, Command, CheckCircle, ShieldCheck, CreditCard, QrCode];
/** Mounted once by the route layout; feature pages own their data and actions. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut, userId, orgId, sessionId } = useOperatorAuth();
  const pathname = usePathname();
  const enabledViews = useMemo(() => visibleResources(), []);
  const active = resourceForPath(pathname) ?? resources[0];
  const activeViewId = active.id;
  const [controls, setControls] = useState<ConsoleControls | null>(null);
  const identity = String(userId) + ":" + String(orgId);
  const [cacheIdentity, setCacheIdentity] = useState<string | null>(null);
  const path = controls?.key === pathname ? pathname : null;
  const refreshPending = controls?.pending ?? false;
  const refresh = async () => { await controls?.refresh(); };
  const [sessionAuditError, setSessionAuditError] = useState<ApiError | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const signOutGuard = useRef(new MutationGuard());
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const sidebarScrollTopRef = useRef(0);
  const pendingSidebarScrollTopRef = useRef<number | null>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const rememberSidebarScroll = useCallback(() => {
    const scrollTop = sidebarNavRef.current?.scrollTop ?? sidebarScrollTopRef.current;
    sidebarScrollTopRef.current = scrollTop;
    pendingSidebarScrollTopRef.current = scrollTop;
  }, []);
  const shellContext = useMemo(() => ({ setControls, rememberSidebarScroll }), [rememberSidebarScroll]);
  const closeNavigation = () => { setSidebarOpen(false); mobileMenuRef.current?.focus(); };
  const endSession = async () => {
    if (signOutGuard.current.isPending) return;
    setSigningOut(true);
    setSessionAuditError(null);
    try {
      await signOutGuard.current.run("session-end", { event: "ended" }, async (idempotencyKey) => {
        if (sessionId) {
          const token = await getTokenWithTimeout(getToken);
          if (!token) throw new ApiError("The operator session could not be verified.", "unauthorized");
          await apiRequest("/session/events", { token, method: "POST", body: { event: "ended" }, idempotencyKey });
        }
        clearViewCache();
        await signOut();
      });
    } catch (error) {
      setSessionAuditError(error instanceof ApiError ? error : new ApiError("Sign-out could not be completed. Try again.", "unavailable"));
    } finally { setSigningOut(false); }
  };
  useEffect(() => { if (sidebarOpen) mobileCloseRef.current?.focus(); }, [sidebarOpen]);
  useLayoutEffect(() => {
    const nav = sidebarNavRef.current;
    if (!nav) return;
    const target = pendingSidebarScrollTopRef.current ?? sidebarScrollTopRef.current;
    nav.scrollTop = target;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        nav.scrollTop = target;
        sidebarScrollTopRef.current = target;
        pendingSidebarScrollTopRef.current = null;
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [pathname]);
  useEffect(() => {
    window.addEventListener("popstate", rememberSidebarScroll);
    return () => window.removeEventListener("popstate", rememberSidebarScroll);
  }, [rememberSidebarScroll]);
  useLayoutEffect(() => {
    clearViewCache();
    setCacheIdentity(identity);
  }, [identity]);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !orgId) return;
    const warmable: Record<string, string> = { clients: "/tenants", payments: "/subscription-payments?status=pending", "payment-methods": "/platform-payment-methods" };
    const paths = enabledViews.map((view) => warmable[view.id]).filter(Boolean);
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
  return <ConsoleControlsContext.Provider value={shellContext}><div className="app-frame">
    <a className="skip-link" href="#main-content">Skip to content</a>{sidebarOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={closeNavigation} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && sidebarOpen) closeNavigation(); }}><div className="brand"><BrandMark /><span><span className="brand-name">Drezivo</span><span className="brand-secondary">Operator</span></span><button ref={mobileCloseRef} className="icon-button mobile-close" aria-label="Close navigation" onClick={closeNavigation}><X size={18} /></button></div>
      <div className="workspace-switch"><span className="workspace-label">Workspace</span><div className="organization-control">{isLocalOperator ? <span>Local operator organization</span> : <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" afterLeaveOrganizationUrl="/" appearance={{ elements: { rootBox: { width: "100%" }, organizationSwitcherTrigger: { width: "100%", justifyContent: "space-between", padding: "8px 10px", borderRadius: "7px" } } }} />}</div></div>
      <div className="search-box"><MagnifyingGlass size={15} /><input aria-label="Filter navigation" placeholder="Find a view" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Clear navigation filter" onClick={() => setSearch("")}>Clear</button>}</div>
      <nav ref={sidebarNavRef} aria-label="Main navigation" onScroll={(event) => { if (pendingSidebarScrollTopRef.current === null) sidebarScrollTopRef.current = event.currentTarget.scrollTop; }}>{filteredResources.length === 0 ? <p className="nav-empty" role="status">No views match “{search.trim()}”.</p> : groups.map((group) => { const groupResources = filteredResources.filter((resource) => resource.group === group); return groupResources.length > 0 && <div className="nav-group" key={group}><span className="nav-label">{group}</span>{groupResources.map((item) => { const index = resources.indexOf(item); const Icon = icons[index]; return <Link key={item.id} className={`nav-item ${activeViewId === item.id ? "active" : ""}`} href={item.path} scroll={false} aria-current={activeViewId === item.id ? "page" : undefined} onClick={() => { rememberSidebarScroll(); setSidebarOpen(false); }}><Icon size={17} weight={activeViewId === item.id ? "fill" : "regular"} /><span>{item.label}</span></Link>; })}</div>; })}</nav>
      <div className="sidebar-bottom"><div className="api-status"><span className="status-dot status-neutral" /><span><strong>API connection</strong><small>Checked per request</small></span></div><button className="profile-button" disabled={signingOut} aria-busy={signingOut} onClick={() => void endSession()}><span className="avatar">{(userId || "OP").slice(0, 2).toUpperCase()}</span><span><strong>Superadmin session</strong><small>{signingOut?"Signing out...":"Sign out"}</small></span><SignOut size={16} /></button></div>
    </aside>
    <main id="main-content" className="main-area"><header className="topbar"><div className="crumb"><button ref={mobileMenuRef} className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><List size={18} /></button><span>Operator console</span><span className="crumb-separator">/</span><strong>{active.label}</strong></div><div className="topbar-right"><span className={`environment-label ${isLocalOperator?"local-environment":""}`}>{isLocalOperator?"Local Docker / synthetic data":"Internal"}</span><ThemeToggle />{path && <button className="icon-button refresh-button" aria-label={refreshPending ? "Refreshing data" : "Refresh data"} aria-busy={refreshPending} disabled={refreshPending || !path} onClick={() => { void refresh(); }}><ArrowClockwise className={refreshPending ? "spin" : undefined} size={17} /></button>}</div></header>
        <div className="page-content">
          {sessionAuditError && <div className="session-audit-error" role="alert">{sessionAuditError.message} Your session remains open; use Sign out to retry.</div>}
          {cacheIdentity === identity ? children : <LoadingPanel />}
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
  </div></ConsoleControlsContext.Provider>;
}
