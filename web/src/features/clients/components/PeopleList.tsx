"use client";
import { useState } from "react";
import { ArrowClockwise, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useCachedLoad } from "@/shared/api/view-cache";
import { clientPaths } from "@/features/clients/api";
import { personLabel, type PersonRow } from "@/features/clients/model";
import { formatManila } from "@/shared/lib/format";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from "@/shared/ui/StatePanels";
import { StatusBadge } from "@/shared/ui/StatusBadge";

export function PeopleList({ token, onOpenBusiness }: { token: (signal?: AbortSignal) => Promise<string>; onOpenBusiness: (tenantId: string) => void }) {
  const [people, load] = useCachedLoad<{ items: PersonRow[] }>(clientPaths.people, token);
  const [query, setQuery] = useState("");
  if (people.status === "loading") return <LoadingPanel />;
  if (people.status === "error") return <StatePanel error={people.error} dependency="Business API" onRetry={() => void load()} />;
  const all = people.data.items;
  const text = query.trim().toLowerCase();
  const rows = all.filter((person) => !text
    || [person.profile?.name, person.profile?.email, person.clerk_user_id, person.tenant_name].some((value) => value?.toLowerCase().includes(text)));
  return <>
    <div className="clients-toolbar">
      <div className="clients-search-row">
        <label className="clients-search"><span className="visually-hidden">Find a person</span><MagnifyingGlass size={16} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a person by name, email, user ID or business" /></label>
        <button className="button button-secondary" type="button" onClick={() => void load()}><ArrowClockwise size={15} /> Refresh</button>
      </div>
    </div>
    {rows.length === 0 ? <EmptyPanel title={all.length === 0 ? "No people yet" : "No person matches"} body={all.length === 0 ? "Owners and staff appear here after onboarding." : "Try a different name, email or business."} />
      : <ul className="data-list people-list" aria-label="People">
        <li className="data-list-head" aria-hidden="true"><span>Person</span><span>Business</span><span>Role</span><span>Access</span><span>Last sign-in</span><span /></li>
        {rows.map((person) => {
          const label = personLabel(person);
          return <li key={person.membership_id} className="data-row">
            <button type="button" className="row-link" onClick={() => onOpenBusiness(person.tenant_id)} aria-label={`${label.primary}, ${person.tenant_name}. Open business`}>
              <span className="row-title">{label.primary}</span>{label.secondary && <span className="row-sub">{label.secondary}</span>}
            </button>
            <dl className="row-fields">
              <div><dt>Business</dt><dd>{person.tenant_name}</dd></div>
              <div><dt>Role</dt><dd>{person.role === "owner" ? "Owner" : "Front desk"}</dd></div>
              <div className="field-status"><dt>Access</dt><dd><StatusBadge value={person.status} />{person.profile?.banned && <> <StatusBadge value="banned" /></>}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatManila(person.profile?.last_sign_in_at, true)}</dd></div>
            </dl>
            <CaretRight className="row-chevron" size={16} aria-hidden="true" />
          </li>;
        })}
      </ul>}
    <p className="muted clients-footnote">{rows.length} of {all.length} people · Suspend or reactivate someone from their business <RequestId requestId={people.requestId} /></p>
  </>;
}
