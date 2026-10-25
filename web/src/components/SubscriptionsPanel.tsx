"use client";
import Link from 'next/link';
import { operatorLabel } from '@/lib/access';
import { formatManila } from '@/lib/clients';
import type { SubscriptionPage } from '@/lib/api';
import { EmptyPanel } from './StatePanels';
import { StatusBadge } from './StatusBadge';
import { PaginationControls } from './PaginationControls';
const money = (value: string | undefined | null, currency: string) => value == null ? 'Not recorded' : new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(Number(value) / 100);
export function SubscriptionsPanel({ data, pageNumber, hasPrevious, onPrevious, onNext }: {
    data: SubscriptionPage;
    pageNumber: number;
    hasPrevious: boolean;
    onPrevious: () => void;
    onNext: (cursor: string) => void;
}) {
    return <section><p className="muted">Latest verified payment and current billing period for every subscription. Amounts come from the server.</p>{data.items.length === 0 ? <EmptyPanel title="No subscriptions" body="No subscriptions match this page."/> : <div className="table-wrap"><table><thead><tr><th>Business</th><th>Plan and status</th><th>Verified payment</th><th>Payer</th><th>Reviewed by</th><th>Next due</th></tr></thead><tbody>{data.items.map(s => <tr key={s.tenant_id}>
  <td><Link href={`/?view=clients&client=${s.tenant_id}`} scroll={false}>{s.business_name}</Link></td><td><strong>{s.plan_code.charAt(0).toUpperCase()+s.plan_code.slice(1)}</strong><small className="console-detail">{money(s.amount_minor, s.currency)} / month</small><StatusBadge value={s.status}/></td>
  <td>{s.paid_at ? <><strong>{money(s.paid_amount_minor, s.currency)}</strong><small className="console-detail">{formatManila(s.paid_at, true)}</small></> : 'No verified payment'}</td>
  <td>{s.payer_key ? <details className="technical-details"><summary>Recorded payer</summary><span className="console-detail">{s.payer_key}</span></details> : 'Not recorded'}</td><td>{s.reviewed_by ? operatorLabel(s.reviewed_by) : 'Not recorded'}</td><td><>{s.current_period_end ? <time dateTime={s.current_period_end}>{formatManila(s.current_period_end, true)}</time> : s.plan_code === "free" ? "No renewal due" : "Not recorded"}</>{s.trial_ends_at && s.status === 'trialing' && <small className="console-detail">Trial ends {formatManila(s.trial_ends_at, true)}</small>}{s.grace_ends_at && <small className="console-detail">Read-only until {formatManila(s.grace_ends_at, true)}</small>}</td>
 </tr>)}</tbody></table></div>}<PaginationControls pageNumber={pageNumber} hasPrevious={hasPrevious} nextCursor={data.next_cursor ?? null} onPrevious={onPrevious} onNext={onNext}/></section>;
}
