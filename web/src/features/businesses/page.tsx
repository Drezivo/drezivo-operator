"use client";
import Link from "next/link";
import { ApiResource, PagedResource, type ResourcePagination } from "@/shared/api/ApiResource";
import type { PageData } from "@/shared/api/client";
import { businessHref, clientHref } from "@/shared/navigation/resources";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { PaginationControls } from "@/shared/ui/PaginationControls";
import { RecordTable, renderRecordCell } from "@/shared/ui/RecordTable";
import { useBusinessNames } from "@/features/clients/use-business-names";

function BusinessRecords({ data, pagination }: { data: unknown; pagination?: ResourcePagination }) {
  const names = useBusinessNames();
  const remember = useConsoleNavigation();
  return <><RecordTable data={data} cell={(row, column) => column === "tenant_id"
    ? <Link href={clientHref(String(row[column]))} scroll={false} onClick={remember}>{names.find((business) => business.tenant_id === row[column])?.name ?? "Business record"}</Link>
    : renderRecordCell(row[column], column)}
    action={(row) => <Link className="table-action" href={businessHref(String(row.tenant_id || row.id))} scroll={false} onClick={remember}>View details</Link>} />
    {pagination && <PaginationControls {...pagination} nextCursor={(data as PageData).next_cursor ?? null} />}
  </>;
}
export function BusinessesPage({ tenantId }: { tenantId?: string }) {
  return <ConsolePage feature="businesses" title={tenantId ? "Business details" : undefined} description={tenantId ? "Business record for " + tenantId + " returned by the operator API." : undefined}>
    {tenantId ? <ApiResource path={"/businesses/" + encodeURIComponent(tenantId)} dependency="Business API">{(data) => <BusinessRecords data={data} />}</ApiResource>
      : <PagedResource<PageData> path="/businesses?limit=25" dependency="Business API">{(data, pagination) => <BusinessRecords data={data} pagination={pagination} />}</PagedResource>}
  </ConsolePage>;
}
