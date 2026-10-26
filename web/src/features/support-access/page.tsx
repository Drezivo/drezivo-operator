"use client";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { SupportAccessPanel } from "./components/SupportAccessPanel";

export function SupportAccessPage() {
  const { getToken, userId } = useOperatorAuth();
  const remember = useConsoleNavigation();
  return <ConsolePage feature="grants"><SupportAccessPanel getToken={getToken} currentOperatorId={userId} onKeepSidebarScroll={remember} /></ConsolePage>;
}
