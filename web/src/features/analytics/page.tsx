"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useApiResource } from "@/shared/api/use-api-resource";
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
function parsePaid(data: unknown): { count: number; synthetic_count: number | null } {
  if (typeof data !== "object" || data === null || !("count" in data) || !("synthetic_count" in data)) throw new Error("Invalid paid-business count.");
  const value = data as { count: unknown; synthetic_count: unknown };
  if (!Number.isSafeInteger(value.count) || (value.count as number) < 0 || !(value.synthetic_count === null || (Number.isSafeInteger(value.synthetic_count) && (value.synthetic_count as number) >= 0))) throw new Error("Invalid paid-business count.");
  return value as { count: number; synthetic_count: number | null };
}
function PaidBusinessMetric() {
  const { state } = useApiResource("/analytics/paid-businesses", parsePaid);
  const value = state.status === "ready" ? new Intl.NumberFormat("en-PH").format(state.data.count) : state.status === "loading" ? "Loading…" : "Unavailable";
  return <article className="metric-card"><span>Paid businesses</span><strong>{value}</strong><small>{state.status === "ready" && state.data.synthetic_count !== null ? `Synthetic test businesses: ${state.data.synthetic_count}` : "Businesses with a current paid period"}</small></article>;
}
export function AnalyticsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const remember = useConsoleNavigation();
  const requested = Number(params.get("months"));
  const months = [6, 12, 24].includes(requested) ? requested : 6;
  return <ConsolePage feature="analytics"><ApiResource path={analyticsPath(months)} parse={parse} dependency="Business API">
    {(data) => <AnalyticsPanel paidMetric={<PaidBusinessMetric />} data={data} months={months} onMonthsChange={(value) => {
      remember();
      router.push("/analytics?months=" + value, { scroll: false });
    }} />}
  </ApiResource></ConsolePage>;
}
