"use client";
import { useCallback } from "react";
import { ApiError } from "@/shared/api/client";
import { getTokenWithTimeout } from "@/shared/auth/token";
import { DEFAULT_CLIENT_FILTER, type ClientFilter } from "@/features/clients/model";
import { BusinessList } from "./BusinessList";
import { PeopleList } from "./PeopleList";
import { ClientDetailView } from "./ClientDetailView";

export type ClientsTab = "businesses" | "people";
export type ClientsNavigation = { client?: string | null; tab?: ClientsTab; filter?: ClientFilter };

export function ClientsPanel({ getToken, workspaceGrantId = null, clientId = null, tab = "businesses", filter = DEFAULT_CLIENT_FILTER, onNavigate }: {
  getToken: () => Promise<string | null>;
  clientId?: string | null;
  workspaceGrantId?: string | null;
  tab?: ClientsTab;
  filter?: ClientFilter;
  onNavigate: (next: ClientsNavigation) => void;
}) {
  const token = useCallback(async (signal?: AbortSignal) => {
    const value = await getTokenWithTimeout(getToken, signal);
    if (!value) throw new ApiError("The operator session could not be verified.", "unauthorized");
    return value;
  }, [getToken]);

  if (clientId) return <ClientDetailView key={clientId} workspaceGrantId={workspaceGrantId} tenantId={clientId} token={token} onBack={() => onNavigate({ client: null })} />;
  return <div className="clients">
    <div className="segmented" role="tablist" aria-label="Show">
      {(["businesses", "people"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => onNavigate({ tab: id })}>{id === "businesses" ? "Businesses" : "People"}</button>)}
    </div>
    {tab === "people"
      ? <PeopleList token={token} onOpenBusiness={(id) => onNavigate({ client: id })} />
      : <BusinessList token={token} filter={filter} onFilter={(next) => onNavigate({ filter: next })} onOpen={(id) => onNavigate({ client: id })} />}
  </div>;
}
