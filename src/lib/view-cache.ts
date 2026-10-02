"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiRequest } from "./api";

/**
 * Stale-while-revalidate for console views. A view the operator has already opened in this tab
 * renders its last response immediately, then refreshes in the background; nothing waits on the
 * network to switch views. Data lives in memory only (never storage) and is cleared on sign-out or
 * when the signed-in operator or organization changes, so one session never sees another's data.
 */

type Entry = { data: unknown; requestId: string };

const MAX_ENTRIES = 50;
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();
// Per path, bumped whenever a command's result is written, so an older read never replaces it.
const writes = new Map<string, number>();

export function clearViewCache(): void {
  cache.clear();
  inFlight.clear();
  writes.clear();
}

function remember(path: string, entry: Entry): void {
  cache.delete(path);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(path, entry);
}

type TokenSource = (signal?: AbortSignal) => Promise<string>;

/**
 * One network read per path at a time; concurrent callers (a view and a prefetch) share it. The
 * shared read is deliberately not cancellable by one caller: a view that unmounts simply ignores the
 * result, which still lands in the cache (apiRequest has its own timeout).
 */
async function fetchInto<T>(path: string, token: TokenSource, joinInFlight = true): Promise<{ data: T; requestId: string }> {
  // A reload after a command must not reuse a read that started before the command.
  const shared = joinInFlight ? inFlight.get(path) : undefined;
  if (shared) return shared as Promise<{ data: T; requestId: string }>;
  const startedAt = writes.get(path) ?? 0;
  const request = (async () => {
    const result = await apiRequest<T>(path, { token: await token() });
    if ((writes.get(path) ?? 0) === startedAt) remember(path, result);
    return result;
  })().finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}

/** Warms views the operator is likely to open next. Failures are ignored; the view retries itself. */
export function prefetchViews(paths: readonly string[], token: TokenSource): void {
  for (const path of paths) {
    if (!cache.has(path)) void fetchInto(path, token).catch(() => undefined);
  }
}

export type CachedLoad<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; requestId: string; refreshing: boolean }
  | { status: "error"; error: ApiError };

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("An unexpected error occurred.", "http");
}

/**
 * Loads `path`, showing the cached response first when there is one. `reload()` refetches while
 * keeping the current data on screen; `replace()` puts a fresh server response (for example the
 * result of a command) on screen and in the cache.
 */
export function useCachedLoad<T>(path: string, token: TokenSource) {
  const initial = (): CachedLoad<T> => {
    const hit = cache.get(path);
    return hit ? { status: "ready", data: hit.data as T, requestId: hit.requestId, refreshing: true } : { status: "loading" };
  };
  const [state, setState] = useState<CachedLoad<T>>(initial);
  // Bumped by replace(): a read that started before a command's result must not overwrite it.
  const version = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, joinInFlight = true) => {
    const startedAt = version.current;
    const hit = cache.get(path);
    setState(hit
      ? { status: "ready", data: hit.data as T, requestId: hit.requestId, refreshing: true }
      : { status: "loading" });
    try {
      const result = await fetchInto<T>(path, token, joinInFlight);
      if (signal?.aborted || version.current !== startedAt) return;
      setState({ status: "ready", data: result.data, requestId: result.requestId, refreshing: false });
    } catch (error) {
      if (signal?.aborted) return;
      // A failed refresh keeps the last good data visible; only a first load shows the error.
      setState((current) => current.status === "ready" ? { ...current, refreshing: false } : { status: "error", error: asApiError(error) });
    }
  }, [path, token]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const replace = useCallback((data: T, requestId: string) => {
    version.current += 1;
    writes.set(path, (writes.get(path) ?? 0) + 1);
    remember(path, { data, requestId });
    setState({ status: "ready", data, requestId, refreshing: false });
  }, [path]);

  /** Explicit refresh (Retry, after a command): always a new read, current data stays visible. */
  const reload = useCallback(() => load(undefined, false), [load]);

  return [state, reload, replace] as const;
}
