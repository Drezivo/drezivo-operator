"use client";
import { useState } from "react";
import Link from "next/link";
import { PagedResource, type ResourcePagination } from "@/shared/api/ApiResource";
import type { PageData } from "@/shared/api/client";
import { clientHref } from "@/shared/navigation/resources";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { RecordTable, formatLabel, renderRecordCell, type RecordRow } from "@/shared/ui/RecordTable";
import { PaginationControls } from "@/shared/ui/PaginationControls";
import { RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { useBusinessNames } from "@/features/clients/use-business-names";
import { useRetryCommand, type RetryCommand } from "../use-retry-command";

type Kind = "jobs" | "notifications";
function retryFor(kind: Kind, row: RecordRow): RetryCommand | null {
  const id = String(row.id || row.job_id || row.delivery_id || "");
  const status = String(row.status || row.state || "").toLowerCase();
  if (!id || row.can_retry !== true || status !== (kind === "jobs" ? "dead" : "failed")) return null;
  return { key: kind + ":" + id + ":retry", path: "/" + kind + "/" + encodeURIComponent(id) + "/retry", label: kind === "jobs" ? "Retry job" : "Retry delivery" };
}
function OperationsTable({ kind, data, pagination, commands, refresh }: {
  kind: Kind; data: PageData; pagination: ResourcePagination;
  commands: ReturnType<typeof useRetryCommand>; refresh: () => Promise<void>;
}) {
  const names = useBusinessNames();
  const remember = useConsoleNavigation();
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const columns = kind === "jobs" ? ["event_type", "tenant_id", "status", "attempts", "max_attempts", "available_at"]
    : ["tenant_id", "channel", "status", "template_version", "accepted_at", "delivered_at"];
  return <>
    {commands.notice && <p className="action-success" role="status">{commands.notice.message}<RequestId requestId={commands.notice.requestId} /></p>}
    {commands.error && <StatePanel error={commands.error} dependency="Business API" onRetry={() => (document.getElementById("retry-action-form") as HTMLFormElement | null)?.requestSubmit()} />}
    <RecordTable data={data} columns={columns} labels={{ tenant_id: "Business", event_type: "Job", max_attempts: "Retry limit" }}
      cell={(row, column) => column === "tenant_id" ? <Link href={clientHref(String(row.tenant_id))} scroll={false} onClick={remember}>{names.find((business) => business.tenant_id === row.tenant_id)?.name ?? "Business record"}</Link>
        : column === "event_type" ? formatLabel(String(row[column]).replaceAll(".", " ")) : renderRecordCell(row[column], column)}
      action={(row) => {
        const action = retryFor(kind, row);
        if (!action) return null;
        return selected === action.key ? <form id="retry-action-form" className="retry-form" onSubmit={async (event) => {
          event.preventDefault();
          if (!reason.trim() || commands.pending !== null) return;
          if (await commands.run(action, reason, refresh)) { setSelected(null); setReason(""); }
        }}><label>Reason for retry<textarea required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={commands.pending !== null} /></label><span>
          <button type="button" className="text-button" disabled={commands.pending !== null} onClick={() => { setSelected(null); setReason(""); commands.clear(); }}>Cancel</button>
          <button className="table-action" type="submit" disabled={commands.pending !== null || !reason.trim()}>{commands.pending === action.key ? "Sending..." : "Confirm retry"}</button>
        </span></form> : <button className="table-action" disabled={commands.pending !== null} onClick={() => { commands.clear(); setSelected(action.key); setReason(""); }}>{action.label}</button>;
      }} />
    <PaginationControls {...pagination} nextCursor={data.next_cursor ?? null} />
  </>;
}
export function OperationsPage({ kind }: { kind: Kind }) {
  const commands = useRetryCommand();
  return <ConsolePage feature={kind}><PagedResource<PageData> path={"/" + kind + "?limit=25"} dependency="Business API">
    {(data, pagination, refresh) => <OperationsTable kind={kind} data={data} pagination={pagination} commands={commands} refresh={refresh} />}
  </PagedResource></ConsolePage>;
}
