"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiResource } from "@/shared/api/ApiResource";
import { ApiError } from "@/shared/api/client";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import { analyticsPath, parseAnalyticsResponse } from "./model";

function parse(data: unknown) {
  try { return parseAnalyticsResponse(data); }
  catch (error) { throw new ApiError(error instanceof Error ? error.message : "The operator API returned invalid analytics.", "invalid_response"); }
}
export function AnalyticsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const remember = useConsoleNavigation();
  const requested = Number(params.get("months"));
  const months = [12, 24, 36, 48].includes(requested) ? requested : 48;
  return <ConsolePage feature="analytics"><ApiResource path={analyticsPath(months)} parse={parse} dependency="Business API">
    {(data) => <AnalyticsPanel data={data} months={months} onMonthsChange={(value) => {
      remember();
      router.push("/analytics?months=" + value, { scroll: false });
    }} />}
  </ApiResource></ConsolePage>;
}
