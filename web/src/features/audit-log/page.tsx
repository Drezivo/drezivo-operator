"use client";
import { useSearchParams } from "next/navigation";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { AuditPanel } from "./components/AuditPanel";

export function AuditLogPage() {
  const { getToken } = useOperatorAuth();
  const actor = useSearchParams().get("actor") ?? "";
  return <ConsolePage feature="audit"><AuditPanel key={actor} getToken={getToken} actor={actor} /></ConsolePage>;
}
