"use client";
import { useMemo, useState } from "react";
import { ArrowClockwise, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useCachedLoad } from "@/shared/api/view-cache";
import { clientPaths } from "@/features/clients/api";
import { clientAttention, clientState, clientStateLabel, clientStateTone, matchesFilter, type ClientFilter, type ClientSummary } from "@/features/clients/model";
import { formatManila } from "@/shared/lib/format";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { StatusBadge } from "@/shared/ui/StatusBadge";

const FILTERS: Array<{ id: ClientFilter; label: string }> = [
  { id: "attention", label: "Needs attention" },
  { id: "pending", label: "Payment to review" },
  { id: "trial", label: "On trial" },
  { id: "unpaid", label: "Unpaid" },
  { id: "locked", label: "Locked" },
  { id: "paid", label: "Paid" },
  { id: "free", label: "Free" },
  { id: "all", label: "All" },
];

export function BusinessList({ token, filter, onFilter, onOpen }: { token: (signal?: AbortSignal) => Promise<string>; filter: ClientFilter; onFilter: (filter: ClientFilter) => void; onOpen: (id: string) => void }) {
  const [list, load] = useCachedLoad<{ items: ClientSummary[] }>(clientPaths.list, token);
  const [query, setQuery] = useState("");
  const now = useMemo(() => new Date(), [list]);
  if (list.status === "loading") return <LoadingPanel />;
  if (list.status === "error") return <StatePanel error={list.error} dependency="Business API" onRetry={() => void load()} />;

  const all = list.data.items;
  const counts = Object.fromEntries(FILTERS.map(({ id }) => [id, all.filter((client) => matchesFilter(client, id, now)).length])) as Record<ClientFilter, number>;
  const text = query.trim().toLowerCase();
  const rows = all.filter((client) => matchesFilter(client, filter, now)
    && (!text || client.name.toLowerCase().includes(text) || client.slug.includes(text) || client.tenant_id.startsWith(text)));

  return <>
    <div className="clients-toolbar">
      <div className="filter-chips" role="group" aria-label="Filter businesses">
        {FILTERS.map(({ id, label }) => <button key={id} type="button" className={`filter-chip ${filter === id ? "active" : ""} ${id === "attention" && counts.attention > 0 ? "has-alert" : ""}`} aria-pressed={filter === id} onClick={() => onFilter(id)}>
          {label}<span className="chip-count">{counts[id]}</span>
        </button>)}
      </div>
      <div className="clients-search-row">
        <label className="clients-search"><span className="visually-hidden">Find a business</span><MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a business by name, storefront or ID" /></label>
        <button className="button button-secondary" type="button" onClick={() => void load()}><ArrowClockwise size={15} /> Refresh</button>
      </div>
    </div>
    {rows.length === 0
      ? <EmptyPanel title={all.length === 0 ? "No businesses yet" : filter === "attention" && !text ? "Nothing needs attention" : "No business matches"}
          body={all.length === 0 ? "Businesses appear here after an owner finishes onboarding." : filter === "attention" && !text ? "No payment is waiting, no trial or paid month ends in the next 3 days, and every business has full access." : "Try another filter or search term."} />
      : <ul className="data-list client-list" aria-label="Businesses">
        <li className="data-list-head" aria-hidden="true"><span>Business</span><span>Status</span><span>What to know</span><span>Plan</span><span>Staff</span><span>Joined</span><span /></li>
        {rows.map((client) => {
          const state = clientState(client);
          return <li key={client.tenant_id} className={`data-row state-${state}`}>
            <button type="button" className="row-link" onClick={() => onOpen(client.tenant_id)}>
              <span className="row-title">{client.name}</span><span className="row-sub">/s/{client.slug}</span>
            </button>
            <dl className="row-fields">
              <div className="field-status"><dt>Status</dt><dd><StatusBadge value={clientStateTone[state]} label={clientStateLabel[state]} /></dd></div>
              <div className="field-note"><dt>What to know</dt><dd>{clientAttention(client, now)}</dd></div>
              <div><dt>Plan</dt><dd className="capitalize">{client.subscription?.plan_code ?? "—"}</dd></div>
              <div><dt>Staff</dt><dd>{client.member_counts.active} active{client.member_counts.suspended > 0 ? ` · ${client.member_counts.suspended} suspended` : ""}</dd></div>
              <div><dt>Joined</dt><dd>{formatManila(client.created_at)}</dd></div>
            </dl>
            <CaretRight className="row-chevron" size={16} aria-hidden="true" />
          </li>;
        })}
      </ul>}
    <p className="muted clients-footnote">{rows.length} of {all.length} businesses · Dates in Manila time <RequestId requestId={list.requestId} /></p>
  </>;
}
