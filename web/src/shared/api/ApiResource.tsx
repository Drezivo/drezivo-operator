"use client";

import { useState, type ReactNode } from "react";
import { withCursor } from "./client";
import { useApiResource, type ResourceParser } from "./use-api-resource";
import { useConsoleRefresh } from "@/shared/shell/console-controls";
import { LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";

export function ApiResource<T>({ path, parse, dependency, children }: {
  path: string | null; parse?: ResourceParser<T>; dependency?: "Business API" | "Clerk operator directory";
  children: (data: T, refresh: () => Promise<void>) => ReactNode;
}) {
  const { state, refresh, refreshing } = useApiResource(path, parse);
  useConsoleRefresh(refresh, refreshing);
  if (state.status === "loading") return <LoadingPanel />;
  if (state.status === "error") return <StatePanel error={state.error} dependency={dependency} onRetry={() => void refresh()} />;
  return <>{children(state.data, refresh)}<div className="loaded-request"><RequestId requestId={state.requestId} /></div></>;
}

export type ResourcePagination = {
  pageNumber: number; hasPrevious: boolean; onPrevious: () => void; onNext: (cursor: string) => void;
};

export function PagedResource<T>({ path, parse, dependency, children }: {
  path: string; parse?: ResourceParser<T>; dependency?: "Business API" | "Clerk operator directory";
  children: (data: T, pagination: ResourcePagination, refresh: () => Promise<void>) => ReactNode;
}) {
  const [page, setPage] = useState({ base: path, cursors: [null] as Array<string | null>, index: 0 });
  const current = page.base === path ? page : { base: path, cursors: [null], index: 0 };
  const pagination = {
    pageNumber: current.index + 1,
    hasPrevious: current.index > 0,
    onPrevious: () => { if (current.index > 0) setPage({ ...current, index: current.index - 1 }); },
    onNext: (cursor: string) => setPage({ base: path, cursors: [...current.cursors.slice(0, current.index + 1), cursor], index: current.index + 1 }),
  };
  return <ApiResource<T> path={withCursor(path, current.cursors[current.index])} parse={parse} dependency={dependency}>
    {(data, refresh) => children(data, pagination, refresh)}
  </ApiResource>;
}
