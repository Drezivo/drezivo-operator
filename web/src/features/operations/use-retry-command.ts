"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/shared/api/client";
import { MutationGuard } from "@/shared/api/mutations";
import { useSessionToken } from "@/shared/auth/use-session-token";

export type RetryCommand = { key: string; path: string; label: string };
export function useRetryCommand() {
  const token = useSessionToken();
  const guard = useRef(new MutationGuard());
  const mounted = useRef(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<{ message: string; requestId: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: RetryCommand, reason: string, refresh: () => Promise<void>): Promise<boolean> => {
    if (guard.current.isPending) return false;
    setPending(action.key);
    try {
      const body = { reason: reason.trim() };
      const result = await guard.current.run(action.key, body, async (idempotencyKey) =>
        apiRequest(action.path, { token: await token(), method: "POST", body, idempotencyKey }));
      if (!result) return false;
      if (mounted.current) {
        setError(null);
        setNotice({ message: "Action accepted by the API.", requestId: result.requestId });
        await refresh();
      }
      return true;
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ApiError ? failure : new ApiError("The action could not be completed.", "http"));
      return false;
    } finally { if (mounted.current) setPending(null); }
  };
  return { pending, error, notice, run, clear: () => { setError(null); setNotice(null); } };
}
