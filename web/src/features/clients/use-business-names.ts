"use client";
import { useCachedLoad } from "@/shared/api/view-cache";
import { useSessionToken } from "@/shared/auth/use-session-token";
import { clientPaths } from "@/features/clients/api";

export function useBusinessNames() {
  const token = useSessionToken();
  const [businesses] = useCachedLoad<{ items: Array<{ tenant_id: string; name: string }> }>(clientPaths.list, token);
  return businesses.status === "ready" && Array.isArray(businesses.data.items) ? businesses.data.items : [];
}
