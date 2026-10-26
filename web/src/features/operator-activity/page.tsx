"use client";
import { useSearchParams } from "next/navigation";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { AuditPanel } from "@/features/audit-log/components/AuditPanel";

export function OperatorActivityPage() {
  const { getToken } = useOperatorAuth();
  const actor = useSearchParams().get("actor") ?? "";
  return <ConsolePage feature="support"><AuditPanel key={actor} getToken={getToken} actor={actor} operatorOnly /></ConsolePage>;
}
