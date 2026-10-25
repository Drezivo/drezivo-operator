"use client";
import Link from "next/link";
import { PagedResource } from "@/shared/api/ApiResource";
import type { PageData } from "@/shared/api/client";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { PaginationControls } from "@/shared/ui/PaginationControls";
import { RecordTable, renderRecordCell } from "@/shared/ui/RecordTable";

export function OperatorsPage() {
  const remember = useConsoleNavigation();
  return <ConsolePage feature="operators"><PagedResource<PageData> path="/operators?limit=25" dependency="Clerk operator directory">
    {(data, pagination) => <><RecordTable data={data} columns={["display_name", "role", "status", "last_activity_at"]} labels={{ display_name: "Operator", last_activity_at: "Latest activity" }}
      cell={(row, column) => column === "role" ? "Superadmin" : renderRecordCell(row[column], column)}
      action={(row) => <Link className="table-action" href={"/audit-log?actor=" + encodeURIComponent("operator:" + String(row.operator_id))} scroll={false} onClick={remember}>View activity</Link>} />
      <PaginationControls {...pagination} nextCursor={data.next_cursor ?? null} /></>}
  </PagedResource></ConsolePage>;
}
