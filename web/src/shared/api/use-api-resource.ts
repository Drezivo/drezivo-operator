"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "./client";
import { useSessionToken } from "@/shared/auth/use-session-token";

export type ResourceParser<T> = (data: unknown, requestId: string) => T;
type LoadState<T> =
  | { path: string | null; status: "loading" }
  | { path: string; status: "ready"; data: T; requestId: string }
  | { path: string; status: "error"; error: ApiError };

/** Each route owns its request state. A changed path can never render a previous response. */
export function useApiResource<T>(path: string | null, parse?: ResourceParser<T>) {
  const token = useSessionToken();
  const [state, setState] = useState<LoadState<T>>({ path: null, status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const currentPath = useRef(path);
  currentPath.current = path;
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refreshPending = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    if (!path) return;
    const request = ++sequence.current;
    const current = () => !signal.aborted && request === sequence.current && currentPath.current === path;
    setState({ path, status: "loading" });
    try {
      const result = await apiRequest<unknown>(path, { token: await token(signal), signal });
      if (!current()) return;
      const data = parse ? parse(result.data, result.requestId) : result.data as T;
      setState({ path, status: "ready", data, requestId: result.requestId });
    } catch (error) {
      if (!current()) return;
      setState({ path, status: "error", error: error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http") });
    }
  }, [path, token, parse]);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void load(request.signal);
    return () => { controller.current?.abort(); };
  }, [load]);
  const refresh = useCallback(async () => {
    if (!path || refreshPending.current) return;
    refreshPending.current = true;
    setRefreshing(true);
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try { await load(request.signal); }
    finally { refreshPending.current = false; setRefreshing(false); }
  }, [load, path]);
  return { state: state.path === path ? state : { path, status: "loading" } as LoadState<T>, refresh, refreshing };
}
