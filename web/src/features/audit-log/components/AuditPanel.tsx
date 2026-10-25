"use client";
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError } from '@/shared/api/client';
import { getTokenWithTimeout } from '@/shared/auth/token';
import { useCachedLoad } from '@/shared/api/view-cache';
import { formatMinorAmount } from '@/features/analytics/model';
import { formatManila } from "@/shared/lib/format";
import { EmptyPanel, LoadingPanel, RequestId, StatePanel } from '@/shared/ui/StatePanels';
import { PaginationControls } from '@/shared/ui/PaginationControls';
import { BusinessSelect } from '@/features/clients/components/BusinessSelect';
import { auditActionGroups, auditActionLabel } from '@/features/audit-log/model';
import { StatusBadge } from '@/shared/ui/StatusBadge';
type Event = {
    event_id: string;
    tenant_id?: string | null;
    business_name?: string | null;
    occurred_at: string;
    actor_kind: string;
    actor_key: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    outcome: string;
    request_id: string;
    redacted_summary?: string | null;
    billing?: {
        amount_minor: string | null;
        currency: string | null;
        due_at: string | null;
        payer_key?: string | null;
        paid_at?: string | null;
    } | null;
};
type Page = {
    items: Event[];
    next_cursor: string | null;
};
export function AuditPanel({ getToken, actor = '', operatorOnly = false }: {
    getToken: () => Promise<string | null>;
    actor?: string;
    operatorOnly?: boolean;
}) {
    const [filters, setFilters] = useState<Record<string, string>>(actor ? { actor_key: actor } : {}), [cursors, setCursors] = useState<Array<string | null>>([null]), [index, setIndex] = useState(0);
    const token = useCallback(async () => { const value = await getTokenWithTimeout(getToken); if (!value)
        throw new ApiError('Operator sign-in is required.', 'unauthorized'); return value; }, [getToken]);
    const path = useMemo(() => { const p = new URLSearchParams({ limit: '25', ...filters }); if (operatorOnly)
        p.set('actor_kind', 'operator'); if (cursors[index])
        p.set('cursor', cursors[index]!); return `/audit-events?${p}`; }, [filters, operatorOnly, cursors, index]);
    const [state, reload] = useCachedLoad<Page>(path, token);
    const [business, setBusiness] = useState('');
    const [operator, setOperator] = useState(actor);
    const [dateError, setDateError] = useState('');
    const [operators] = useCachedLoad<{items:Array<{operator_id:string;display_name:string}>}>('/operators?limit=100', token);
    const directory = operators.status === 'ready' && Array.isArray(operators.data.items) ? operators.data.items : [];

    function apply(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setDateError('');
        const data = new FormData(event.currentTarget), next: Record<string, string> = {};
        for (const [key, value] of data.entries()) {
            const text = String(value).trim(); if (!text || key === 'actor_exact' || key === 'action_exact') continue;
            if (key.startsWith('occurred_')) { const date = new Date(`${text}+08:00`); if (!Number.isFinite(date.getTime())) { setDateError('Choose valid Manila dates.'); return; } next[key] = date.toISOString(); }
            else next[key] = text;
        }
        for (const [advanced, field] of [['actor_exact','actor_key'],['action_exact','action']] as const) { const exact=String(data.get(advanced)??'').trim(); if(exact) next[field]=exact; }
        if (next.occurred_from && next.occurred_to && next.occurred_from >= next.occurred_to) { setDateError('The end of the date range must be after the start.'); return; }
        setFilters(next); setCursors([null]); setIndex(0);
    }
    return <section className="audit-panel"><form className="console-filters" onSubmit={apply}>
  <BusinessSelect token={token} value={business} onChange={setBusiness} emptyLabel="All businesses" />
  <label>Operator<select name="actor_key" value={operator} onChange={e=>setOperator(e.target.value)}><option value="">All operators and payers</option>{operator && !directory.some(p=>`operator:${p.operator_id}`===operator) && <option value={operator}>Selected operator</option>}{directory.map(p=><option key={p.operator_id} value={`operator:${p.operator_id}`}>{p.display_name}</option>)}</select></label>
  {!operatorOnly && <label>Actor type<select name="actor_kind"><option value="">All platform actors</option><option value="operator">Operators</option><option value="system">System</option><option value="staff">Subscription payers</option><option value="unrecorded">Unattributed billing history</option></select></label>}
  <label>Outcome<select name="outcome"><option value="">All outcomes</option><option value="succeeded">Succeeded</option><option value="rejected">Rejected</option><option value="failed">Failed</option></select></label>
  <label>Action<select name="action"><option value="">All actions</option>{auditActionGroups.map(group=><optgroup key={group.label} label={group.label}>{group.actions.map(([code,title])=><option key={code} value={code}>{title}</option>)}</optgroup>)}</select></label>
  <label>From (Manila)<input name="occurred_from" type="datetime-local"/></label><label>Before (Manila)<input name="occurred_to" type="datetime-local"/></label>
  <details className="console-filter-advanced"><summary>Advanced: exact actor or action ID</summary><p className="field-hint">Optional. Use only when tracing an ID from a support record.</p><div><label>Operator or payer ID<input name="actor_exact" maxLength={200} placeholder="Exact recorded actor ID"/></label><label>Exact action code<input name="action_exact" maxLength={100} placeholder="Exact recorded action"/></label></div></details>
  {dateError && <p className="field-error" role="alert">{dateError}</p>}
  <div className="console-filter-actions"><button className="button button-primary" type="submit">Apply filters</button><button className="button button-secondary" type="reset" onClick={()=>{setBusiness('');setOperator('');setFilters({});setCursors([null]);setIndex(0);setDateError('');}}>Clear filters</button><button className="text-button" type="button" onClick={() => void reload()}>Refresh audit</button></div>
 </form><p className="muted">Platform and operator records only. Times are shown in Asia/Manila. Merchant and front-desk activity is excluded.</p>
 {state.status === 'loading' ? <LoadingPanel /> : state.status === 'error' ? <StatePanel error={state.error} onRetry={() => void reload()}/> : <>
  {state.data.items.length === 0 ? <EmptyPanel title="No platform events" body="No audit records match these filters."/> : <div className="table-wrap"><table><caption className="visually-hidden">System audit and operator accountability</caption><thead><tr><th>When</th><th>Responsible actor</th><th>Action and target</th><th>Business</th><th>Outcome</th><th>Trace</th></tr></thead><tbody>{state.data.items.map(row => <tr key={row.event_id}>
   <td><time dateTime={row.occurred_at}>{formatManila(row.occurred_at, true)}</time></td><td><strong>{row.actor_kind === 'system' ? 'System' : row.actor_kind === 'operator' ? 'Operator' : row.actor_kind === 'unrecorded' ? 'Actor not recorded' : 'Subscription payer'}</strong><small className="console-detail">{directory.find(p=>`operator:${p.operator_id}`===row.actor_key)?.display_name??row.actor_key}</small></td>
   <td><strong>{auditActionLabel(row.action)}</strong><small className="console-detail">{row.entity_type}{row.redacted_summary ? ` / ${row.redacted_summary}` : ''}{row.entity_id ? ` / ${row.entity_id}` : ''}</small>{row.billing?.amount_minor && row.billing.currency && <small className="console-detail">{formatMinorAmount(row.billing.amount_minor, row.billing.currency)}</small>}{row.billing?.payer_key && <small className="console-detail">Payer {row.billing.payer_key}</small>}{row.billing?.paid_at && <small className="console-detail">Verified {formatManila(row.billing.paid_at, true)}</small>}{row.billing?.due_at && <small className="console-detail">Due {formatManila(row.billing.due_at, true)}</small>}</td>
   <td>{row.tenant_id ? <Link href={`/clients/${encodeURIComponent(row.tenant_id)}`} scroll={false}>{row.business_name ?? row.tenant_id}</Link> : 'Platform'}</td><td><StatusBadge value={row.outcome}/></td><td><details><summary>Request details</summary><RequestId requestId={row.request_id}/><small className="console-detail">Event {row.event_id}</small><small className="console-detail">Action {row.action}</small><small className="console-detail">Actor {row.actor_key}</small></details></td>
  </tr>)}</tbody></table></div>}
  <PaginationControls pageNumber={index + 1} hasPrevious={index > 0} nextCursor={state.data.next_cursor} onPrevious={() => setIndex(x => x - 1)} onNext={cursor => { setCursors(x => [...x.slice(0, index + 1), cursor]); setIndex(x => x + 1); }}/><RequestId requestId={state.requestId}/>
 </>}
 </section>;
}
