import { Buildings, ChartLineUp, ClockCounterClockwise, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { Overview } from "@/lib/api";
import { EmptyPanel } from "./StatePanels";
import { StatusBadge } from "./StatusBadge";

const manilaDateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

const subscriptionStatuses = [
  ["active", "Active"],
  ["trial", "Trial"],
  ["grace", "Grace period"],
  ["past_due", "Past due"],
  ["restricted", "Restricted"],
  ["cancelled", "Cancelled"],
  ["missing", "Missing subscription"],
] as const;

const lifecycleSignals = [
  ["expired_trials", "Expired trials"],
  ["expired_grace", "Expired grace periods"],
  ["incomplete_trials", "Incomplete trials"],
  ["incomplete_grace", "Incomplete grace periods"],
] as const;

function formatCount(value: number | undefined): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : "-";
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return manilaDateTime.format(date);
}

function MetricCard({ label, value, detail }: { label: string; value: number | undefined; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{formatCount(value)}</strong><small>{detail}</small></article>;
}

function CountList({ values }: { values: Array<{ label: string; value: number | undefined }> }) {
  return <dl className="attention-list">{values.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{formatCount(value)}</dd></div>)}</dl>;
}

export function OverviewPanel({ data, onKeepSidebarScroll = () => {} }: { data: unknown; onKeepSidebarScroll?: () => void }) {
  const overview = data as Overview;
  const businesses = overview.businesses;
  const subscriptions = overview.subscriptions;
  const attention = overview.attention;
  const statuses = businesses?.by_status ?? [];
  const recentBusinesses = (overview.recent_businesses ?? []).slice(0, 50);

  return <>
    <div className="metric-grid">
      <MetricCard label="Businesses" value={businesses?.total} detail="Across the platform" />
      <MetricCard label="Active subscriptions" value={subscriptions?.active} detail={`${formatCount(subscriptions?.trial)} in trial`} />
      <MetricCard label="Failed jobs" value={attention?.failed_jobs} detail="Needs review" />
      <MetricCard label="Failed notifications" value={attention?.failed_notifications} detail="Needs review" />
    </div>

    <section className="content-card overview-analytics-card" aria-label="Performance analytics">
      <div><span className="eyebrow">Performance</span><h2>Verified cash collection</h2><p>Unavailable: there is no verified payment timestamp or collection workflow.</p></div>
      <Link className="button button-secondary" href="/?view=analytics" scroll={false} onClick={onKeepSidebarScroll}><ChartLineUp size={16} />View analytics</Link>
    </section>

    <section className="overview-bottom" aria-label="Business and subscription summary">
      <div className="content-card status-card">
        <div className="card-heading"><div><span className="eyebrow">Portfolio</span><h2>Businesses by status</h2></div><Buildings size={19} /></div>
        {statuses.length ? <dl className="status-list">{statuses.map(({ status, count }) => <div key={status}><dt><StatusBadge value={status} /></dt><dd>{formatCount(count)}</dd></div>)}</dl> : <EmptyPanel title="No business status totals" body="The overview response did not include business status totals." />}
      </div>
      <div className="content-card status-card">
        <div className="card-heading"><div><span className="eyebrow">Subscriptions</span><h2>Subscription status</h2></div><ClockCounterClockwise size={19} /></div>
        <CountList values={subscriptionStatuses.map(([key, label]) => ({ label, value: subscriptions?.[key] }))} />
      </div>
    </section>

    <section className="overview-bottom" aria-label="Lifecycle and operations attention">
      <div className="content-card status-card">
        <div className="card-heading"><div><span className="eyebrow">Lifecycle</span><h2>Exceptions to review</h2></div><WarningCircle size={19} /></div>
        <CountList values={lifecycleSignals.map(([key, label]) => ({ label, value: subscriptions?.lifecycle?.[key] }))} />
      </div>
      <div className="content-card status-card">
        <div className="card-heading"><div><span className="eyebrow">Operations</span><h2>Needs a closer look</h2></div><WarningCircle size={19} /></div>
        <CountList values={[
          { label: "Failed jobs", value: attention?.failed_jobs },
          { label: "Failed notifications", value: attention?.failed_notifications },
          { label: "Active support grants", value: attention?.active_support_grants },
        ]} />
      </div>
    </section>

    <section className="content-card status-card" aria-labelledby="recent-businesses-heading">
      <div className="card-heading"><div><span className="eyebrow">Latest activity</span><h2 id="recent-businesses-heading">Recent businesses</h2></div><span className="eyebrow">Up to 50 records</span></div>
      {recentBusinesses.length ? <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Business</th><th scope="col">Slug</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
          <tbody>{recentBusinesses.map(({ id, name, slug, status, created_at }) => <tr key={id}>
            <td><Link className="table-business-link" aria-label={`View business ${name}`} href={`/?view=businesses&businessId=${encodeURIComponent(id)}`} scroll={false} onClick={onKeepSidebarScroll}>{name}</Link></td><td>{slug}</td><td><StatusBadge value={status} /></td><td>{formatDateTime(created_at)} (Asia/Manila)</td>
          </tr>)}</tbody>
        </table>
      </div> : <EmptyPanel title="No recent businesses" body="The API returned no businesses for this snapshot." />}
    </section>

    <p className="as-of">Snapshot as of {formatDateTime(overview.as_of)} (Asia/Manila). Values reflect the operator API response.</p>
  </>;
}
