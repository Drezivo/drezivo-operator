"use client";
import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest } from '@/shared/api/client';
import { getTokenWithTimeout } from '@/shared/auth/token';
import { useCachedLoad } from '@/shared/api/view-cache';
import { MutationGuard } from '@/shared/api/mutations';
import { formatManila } from "@/shared/lib/format";
import { operatorLabel, permissionLabel } from '@/shared/lib/access';
import { EmptyPanel, LoadingPanel, StatePanel } from '@/shared/ui/StatePanels';
import { PaginationControls } from '@/shared/ui/PaginationControls';
import { StatusBadge } from '@/shared/ui/StatusBadge';
type Grant = { grant_id: string; tenant_id: string; business_name: string; operator_subject: string; granted_by: string; permission_codes: string[]; starts_at: string; expires_at: string; status: string };
export function GrantHistory({ getToken, currentOperatorId, onKeepSidebarScroll }: { getToken: () => Promise<string | null>; currentOperatorId?: string | null; onKeepSidebarScroll?: () => void }) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]), [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<ApiError | null>(null), [notice, setNotice] = useState('');
  const guard = useRef(new MutationGuard());
  const token = useCallback(async () => { const t = await getTokenWithTimeout(getToken); if (!t) throw new ApiError('Operator sign-in is required.', 'unauthorized'); return t; }, [getToken]);
  const [state, reload, replace] = useCachedLoad<{ items: Grant[]; next_cursor: string | null }>(`/support-grants?limit=25${cursors[index] ? `&cursor=${encodeURIComponent(cursors[index]!)}` : ''}`, token);
  async function revoke(grant: Grant) {
    if (guard.current.isPending) return;
    setPending(true); setError(null); setNotice('');
    try {
      const result = await guard.current.run(`revoke:${grant.grant_id}`, {}, async idempotencyKey => apiRequest(`/support-grants/${grant.grant_id}/revoke`, { token: await token(), method: 'POST', body: {}, idempotencyKey }));
      if (result) { if(state.status==='ready') replace({...state.data,items:state.data.items.map(g=>g.grant_id===grant.grant_id?{...g,status:'revoked'}:g)},result.requestId); setSelected(null); setNotice(`Access to ${grant.business_name} revoked.`); await reload(); }
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError('Access could not be revoked. Try again.', 'http')); }
    finally { setPending(false); }
  }
  return <section className="panel support-history"><div className="card-heading"><div><h2>Support access history</h2><p className="muted">Review who can access each business. Revoke access from its row.</p></div><button type="button" className="button button-secondary" disabled={pending || (state.status === 'ready' && state.refreshing)} onClick={() => void reload()}>Refresh access</button></div>
    {notice && <p className="action-success" role="status">{notice}</p>}{error && <p className="field-error" role="alert">{error.message} Your selection is kept so you can retry.</p>}
    {state.status === 'loading' ? <LoadingPanel /> : state.status === 'error' ? <StatePanel error={state.error} onRetry={() => void reload()} /> : <>
      {state.data.items.length === 0 ? <EmptyPanel title="No support access yet" body="Choose a business and permissions above to start troubleshooting." /> : <div className="table-wrap"><table><caption className="visually-hidden">Temporary support access and revocation controls</caption><thead><tr><th>Business</th><th>Operator</th><th>Permissions</th><th>Access window (Manila)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{state.data.items.map(g => {
        const manageable = g.status === 'active' || g.status === 'scheduled';
        const workspace = g.permission_codes.includes('workspace.read');
        return <tr key={g.grant_id}><td><strong>{g.business_name}</strong><details className="technical-details"><summary>Access details</summary><small className="console-detail">Grant {g.grant_id}</small><small className="console-detail">Granted by {operatorLabel(g.granted_by, currentOperatorId)}</small></details></td>
          <td>{operatorLabel(g.operator_subject, currentOperatorId)}</td><td><ul className="permission-summary">{g.permission_codes.map(p => <li key={p}>{permissionLabel(p)}</li>)}</ul>{!workspace && <small className="console-detail">Legacy read scope</small>}</td>
          <td>{formatManila(g.starts_at, true)}<small className="console-detail">Until {formatManila(g.expires_at, true)}</small></td><td><StatusBadge value={g.status} /></td>
          <td>{g.status === 'active' && workspace && g.operator_subject === currentOperatorId && <Link className="table-action" href={`/clients/${g.tenant_id}?workspaceGrant=${g.grant_id}`} scroll={false} onClick={onKeepSidebarScroll}>Open workspace</Link>}
            {manageable && (selected === g.grant_id ? <div className="inline-confirmation"><p>Revoke {g.operator_subject===currentOperatorId ? 'your' : `${operatorLabel(g.operator_subject, currentOperatorId)}'s`} access to {g.business_name}?</p><div className="action-buttons"><button className="text-button" type="button" disabled={pending} onClick={() => { setSelected(null); setError(null); }}>Cancel</button><button className="button button-danger" type="button" disabled={pending} onClick={() => void revoke(g)}>{pending ? 'Revoking...' : 'Confirm revoke'}</button></div></div> : <button className="table-action" type="button" disabled={pending} onClick={() => { setSelected(g.grant_id); setError(null); setNotice(''); }}>Revoke access</button>)}
            {!manageable && <span className="muted">Access ended</span>}</td></tr>;
      })}</tbody></table></div>}
      <PaginationControls pageNumber={index + 1} hasPrevious={index > 0} nextCursor={state.data.next_cursor} onPrevious={() => setIndex(i => i - 1)} onNext={c => { setCursors(x => [...x.slice(0, index + 1), c]); setIndex(i => i + 1); }} />
    </>}
  </section>;
}
