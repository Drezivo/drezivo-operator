"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { clientHref } from "@/shared/navigation/resources";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { CLIENT_FILTERS, DEFAULT_CLIENT_FILTER } from "./model";
import { ClientsPanel, type ClientsNavigation } from "./components/ClientsPanel";

export function ClientsPage({ tenantId = null }: { tenantId?: string | null }) {
  const { getToken } = useOperatorAuth();
  const router = useRouter();
  const params = useSearchParams();
  const remember = useConsoleNavigation();
  const tab = params.get("tab") === "people" ? "people" : "businesses";
  const filter = CLIENT_FILTERS.find((value) => value === params.get("filter")) ?? DEFAULT_CLIENT_FILTER;
  const navigate = useCallback((next: ClientsNavigation) => {
    remember();
    const query = new URLSearchParams();
    query.set("tab", next.tab ?? tab);
    query.set("filter", next.filter ?? filter);
    const client = next.tab ? null : next.client !== undefined ? next.client : tenantId;
    const path = client ? clientHref(client) : "/clients";
    router.push(path + "?" + query.toString(), { scroll: next.client !== undefined || Boolean(next.tab) });
  }, [router, remember, tab, filter, tenantId]);
  return <ConsolePage feature="clients" title={tenantId ? "Business" : undefined} description={tenantId ? "Account, people and actions for one client business." : undefined}>
    <ClientsPanel getToken={getToken} clientId={tenantId} workspaceGrantId={params.get("workspaceGrant")} tab={tab} filter={filter} onNavigate={navigate} />
  </ConsolePage>;
}
