"use client";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { AnnouncementsPanel } from "./components/AnnouncementsPanel";

export function AnnouncementsPage() {
  const { getToken } = useOperatorAuth();
  return <ConsolePage feature="announcements"><AnnouncementsPanel getToken={getToken} /></ConsolePage>;
}
