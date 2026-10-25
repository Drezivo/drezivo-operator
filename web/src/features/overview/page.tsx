"use client";
import { ApiResource } from "@/shared/api/ApiResource";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { OverviewPanel } from "./components/OverviewPanel";
import type { Overview } from "./model";

export function OverviewPage() {
  const remember = useConsoleNavigation();
  return <ConsolePage feature="overview"><ApiResource<Overview> path="/overview" dependency="Business API">
    {(data) => <OverviewPanel data={data} onKeepSidebarScroll={remember} />}
  </ApiResource></ConsolePage>;
}
