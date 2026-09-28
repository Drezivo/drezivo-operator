import { formatMinorAmount, type AnalyticsForecast, type AnalyticsMonthPoint, type AnalyticsResponse, type AnalyticsSeries, type AnalyticsWeeklySeries, type AnalyticsWeekPoint } from "@/lib/analytics";
import { EmptyPanel } from "./StatePanels";

const manilaDateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});
const monthName = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const eventTypes = ["trial_started", "past_due", "restricted", "plan_changed"] as const;
const horizons = [1, 3, 6, 12] as const;
const forecastLabels: Record<(typeof horizons)[number], string> = { 1: "1 month", 3: "3 months", 6: "6 months", 12: "12 months" };
const withheldLabels: Record<NonNullable<AnalyticsForecast["withheld_reason"]>, string> = {
  insufficient_history: "Withheld: insufficient history",
  baseline_not_beaten: "Withheld: seasonal-naive did not beat the last-value baseline",
};

function formatCount(value: number): string { return new Intl.NumberFormat("en-PH").format(value); }

function formatBoundary(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString()} (${manilaDateTime.format(date)})` : "Time unavailable";
}

function metricCurrencyValues(data: AnalyticsResponse): string[] {
  return data.active_plan_monthly_list_price_run_rate.map(({ currency, amount_minor }) => `${currency} ${formatMinorAmount(amount_minor, currency)}`);
}

function MetricCard({ label, value, detail }: { label: string; value: string | string[]; detail: string }) {
  return <article className="metric-card"><span>{label}</span>{Array.isArray(value)
    ? <strong className="metric-currency-values">{value.length ? value.map((amount) => <span key={amount}>{amount}</span>) : <span>—</span>}</strong>
    : <strong>{value}</strong>}<small>{detail}</small></article>;
}

function Chart({ title, points, kind, unit }: {
  title: string;
  points: Array<{ label: string; count: number; accessibleLabel: string }>;
  kind: "monthly" | "weekly";
  unit: string;
}) {
  const max = Math.max(0, ...points.map((point) => point.count));
  return <section className="analytics-card content-card" aria-label={title}>
    <h2>{title}</h2>
    {points.length ? <div className="chart-scroll"><ul className={`${kind === "monthly" ? "monthly-chart" : "yearly-chart"}`} aria-label={`${title} ${kind === "monthly" ? "monthly" : "weekly"} values`}>
      {points.map((point) => <li key={point.label} aria-label={point.accessibleLabel}>
        <span className="bar-value">{formatCount(point.count)}</span>
        <span className="bar-track"><span className="bar-fill" style={{ height: `${max ? point.count / max * 100 : 0}%` }} /></span>
        <span className="bar-month">{point.label}</span>
      </li>)}
    </ul></div> : <EmptyPanel title={`No ${title.toLowerCase()} history`} body="The API returned no values for this series." />}
    <p className="analytics-note">Counts are {unit}.</p>
  </section>;
}

function monthlyPoints(points: AnalyticsMonthPoint[], unit: string) {
  return points.map((point) => ({
    label: point.month.slice(2),
    count: point.count,
    accessibleLabel: `${point.month}: ${formatCount(point.count)} ${unit}`,
  }));
}

function weeklyPoints(points: AnalyticsWeekPoint[], unit: string) {
  return points.map((point) => ({
    label: point.week,
    count: point.count,
    accessibleLabel: `${point.week}: ${formatCount(point.count)} ${unit}`,
  }));
}

function yearlyPoints(points: AnalyticsMonthPoint[], unit: string) {
  const years = new Map<number, AnalyticsMonthPoint[]>();
  for (const point of points) {
    const year = Number(point.month.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), point]);
  }
  return [...years.entries()].map(([year, yearPoints]) => {
    const total = yearPoints.reduce((sum, point) => sum + point.count, 0);
    const start = yearPoints[0]!.month.slice(5);
    const end = yearPoints.at(-1)!.month.slice(5);
    const range = `${monthName.format(new Date(Date.UTC(year, Number(start) - 1, 1)))}–${monthName.format(new Date(Date.UTC(year, Number(end) - 1, 1)))}`;
    const partial = yearPoints.length < 12;
    return {
      label: <><span>{year}</span><small>{range}{partial ? " · partial" : ""}</small></>,
      count: total,
      accessibleLabel: `${year}, ${range}${partial ? " · partial" : ""}: ${formatCount(total)} ${unit}`,
    };
  });
}

function YearlyChart({ title, points, unit }: { title: string; points: ReturnType<typeof yearlyPoints>; unit: string }) {
  const max = Math.max(0, ...points.map((point) => point.count));
  return <section className="analytics-card content-card" aria-label={title}>
    <h2>{title}</h2>
    {points.length ? <div className="chart-scroll"><ul className="yearly-chart" aria-label={`${title} annual values`}>
      {points.map((point) => <li key={point.accessibleLabel} aria-label={point.accessibleLabel}>
        <span className="bar-value">{formatCount(point.count)}</span>
        <span className="bar-track"><span className="bar-fill" style={{ height: `${max ? point.count / max * 100 : 0}%` }} /></span>
        <span className="bar-month">{point.label}</span>
      </li>)}
    </ul></div> : <EmptyPanel title="No calendar-year history" body="The API returned no values for this series." />}
    <p className="analytics-note">Calendar-year totals from the selected range; partial years are labeled. Counts are {unit}.</p>
  </section>;
}

function Forecast({ label, forecast }: { label: string; forecast: AnalyticsForecast }) {
  const status = forecast.points?.length
    ? `${formatCount(forecast.points.reduce((sum, point) => sum + point.count, 0))} projected ${label}`
    : forecast.points
      ? "Withheld: no monthly projection points returned"
      : withheldLabels[forecast.withheld_reason ?? "insufficient_history"];
  return <li><strong>{forecastLabels[forecast.horizon_months]}</strong><span>{status}</span></li>;
}

function ForecastMonthlyView({ title, unit, forecasts }: { title: string; unit: string; forecasts: AnalyticsForecast[] }) {
  const forecast = forecasts.find((item) => item.horizon_months === 12);
  if (!forecast) return <p className="analytics-note">12-month monthly projection: withheld because no 12-month forecast was returned.</p>;
  if (!forecast.points?.length) {
    const reason = forecast.points ? "Withheld: no monthly projection points returned" : withheldLabels[forecast.withheld_reason ?? "insufficient_history"];
    return <p className="analytics-note">12-month monthly projection: {reason}.</p>;
  }

  const points = monthlyPoints(forecast.points, unit);
  const max = Math.max(0, ...forecast.points.map((point) => point.count));
  return <div>
    <h3>12-month monthly projection</h3>
    <div className="chart-scroll"><ul className="monthly-chart" aria-label={`${title} 12-month monthly values`}>
      {points.map((point) => <li key={point.accessibleLabel} aria-label={point.accessibleLabel}>
        <span className="bar-value">{formatCount(point.count)}</span>
        <span className="bar-track"><span className="bar-fill" style={{ height: `${max ? point.count / max * 100 : 0}%` }} /></span>
        <span className="bar-month">{point.label}</span>
      </li>)}
    </ul></div>
    <div className="table-wrap">
      <table>
        <caption>Projected {unit} by month</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Projected {unit}</th></tr></thead>
        <tbody>{forecast.points.map((point) => <tr key={point.month}><th scope="row">{point.month}</th><td>{formatCount(point.count)}</td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function ForecastCard({ title, label, forecasts }: { title: string; label: string; forecasts: AnalyticsForecast[] }) {
  return <section className="analytics-card content-card">
    <h2>{title}</h2>
    <p className="analytics-note">Seasonal-naive forecasts are evaluated against a last-value baseline and shown only after at least three rolling validation origins.</p>
    <ul className="attention-list">{forecasts.map((forecast) => <Forecast key={forecast.horizon_months} label={label} forecast={forecast} />)}</ul>
    <ForecastMonthlyView title={title} unit={label} forecasts={forecasts} />
  </section>;
}

function eventMonthlyPoints(series: AnalyticsSeries) {
  return series.new_businesses.map(({ month }) => {
    const count = series.subscription_events.filter((event) => event.month === month && eventTypes.includes(event.event_type)).reduce((sum, event) => sum + event.count, 0);
    return { label: month.slice(2), count, accessibleLabel: `${month}: ${formatCount(count)} selected subscription events` };
  });
}

function eventWeeklyPoints(series: AnalyticsWeeklySeries) {
  return series.new_businesses.map(({ week }) => {
    const count = series.subscription_events.filter((event) => event.week === week && eventTypes.includes(event.event_type)).reduce((sum, event) => sum + event.count, 0);
    return { label: week, count, accessibleLabel: `${week}: ${formatCount(count)} selected subscription events` };
  });
}

export function AnalyticsPanel({ data, months, onMonthsChange }: { data: AnalyticsResponse; months: number; onMonthsChange: (months: 12 | 24 | 36 | 48) => void }) {
  const monthlyRunRate = metricCurrencyValues(data);
  const runRateText = monthlyRunRate.length ? monthlyRunRate.join(", ") : "No active-plan prices returned";
  const changeMonths = (value: string) => {
    switch (value) {
      case "12": onMonthsChange(12); break;
      case "24": onMonthsChange(24); break;
      case "36": onMonthsChange(36); break;
      case "48": onMonthsChange(48); break;
    }
  };
  return <div className="analytics-view">
    <div className="analytics-toolbar">
      <label htmlFor="analytics-months">History</label>
      <select id="analytics-months" value={months} onChange={(event) => changeMonths(event.target.value)}>
        {[12, 24, 36, 48].map((option) => <option key={option} value={option}>{option} months</option>)}
      </select>
      <span>Snapshot as of {formatBoundary(data.as_of)} (Asia/Manila), returned by the Operator API.</span>
    </div>

    <p className="analytics-note">Source ingestion lag is not currently measured. Snapshot time describes when the API produced this response, not source-data freshness.</p>
    <p className="analytics-note">Monthly range: [{formatBoundary(data.period.from)}, {formatBoundary(data.period.to)}) Asia/Manila; the “to” end is exclusive.</p>
    <p className="analytics-note">Weekly range: [{formatBoundary(data.weekly_period.from)}, {formatBoundary(data.weekly_period.to)}) Asia/Manila; the “to” end is exclusive.</p>

    <div className="metric-grid analytics-metrics">
      <MetricCard label="Businesses" value={formatCount(data.businesses.total)} detail="Records in this API snapshot" />
      <MetricCard label="Active subscriptions" value={formatCount(data.subscriptions.active)} detail="Subscription status returned by the API" />
      <MetricCard label="Provisioned memberships" value={formatCount(data.members.provisioned)} detail="Membership records, not unique users" />
      <MetricCard label="Active-plan list-price run-rate (pricing proxy)" value={monthlyRunRate} detail="Monthly list-price proxy by currency; not collected income" />
    </div>

    <section className="analytics-card content-card analytics-cash-disclosure" aria-label="Cash collection availability">
      <h2>Cash collection</h2><p>Verified cash collected: unavailable. This API has no verified payment timestamp or collection workflow.</p>
      <p className="analytics-note">{runRateText}. Active-plan monthly list price is a pricing proxy, not collected income.</p>
    </section>

    <div className="analytics-charts">
      <Chart title="New businesses by month" points={monthlyPoints(data.series.new_businesses, "businesses")} kind="monthly" unit="new business records" />
      <YearlyChart title="New businesses by calendar year" points={yearlyPoints(data.series.new_businesses, "businesses")} unit="new business records" />
      <Chart title="New memberships by month" points={monthlyPoints(data.series.memberships, "memberships")} kind="monthly" unit="membership records" />
      <Chart title="New businesses by week" points={weeklyPoints(data.weekly_series.new_businesses, "businesses")} kind="weekly" unit="new business records" />
      <Chart title="New memberships by week" points={weeklyPoints(data.weekly_series.memberships, "memberships")} kind="weekly" unit="membership records" />
      <p className="analytics-note">Subscription event counts include selected types only: trial_started, past_due, restricted, plan_changed.</p>
      <Chart title="Selected subscription events by month" points={eventMonthlyPoints(data.series)} kind="monthly" unit="selected subscription events" />
      <Chart title="Selected subscription events by week" points={eventWeeklyPoints(data.weekly_series)} kind="weekly" unit="selected subscription events" />
    </div>

    <div className="analytics-charts">
      <ForecastCard title="Business additions forecast" label="business additions" forecasts={data.forecasts.new_businesses} />
      <ForecastCard title="Membership additions forecast" label="membership additions" forecasts={data.forecasts.memberships} />
      <section className="analytics-card content-card"><h2>Active-subscriber forecast</h2><p>Withheld: {data.forecasts.active_subscribers.withheld_reason.replaceAll("_", " ")}. No forecast values are available because the API has incomplete history.</p></section>
      <section className="analytics-card content-card"><h2>List-price run-rate forecast</h2><p>Withheld: {data.forecasts.monthly_list_price_run_rate.withheld_reason.replaceAll("_", " ")}. This active-plan list-price proxy is not collected income; forecast values are unavailable because the API has incomplete history.</p></section>
    </div>

    <details className="synthetic-panel">
      <summary>Synthetic QA sample · separate from live metrics</summary>
      <p>Synthetic-only data. These charts are kept separate from live history and forecasts.</p>
      <div className="metric-grid analytics-metrics">
        <MetricCard label="Synthetic businesses" value={formatCount(data.synthetic.businesses.total)} detail="QA fixture; not live platform data" />
        <MetricCard label="Synthetic active subscriptions" value={formatCount(data.synthetic.subscriptions.active)} detail="QA fixture; not live platform data" />
        <MetricCard label="Synthetic provisioned memberships" value={formatCount(data.synthetic.members.provisioned)} detail="QA fixture; not live platform data" />
      </div>
      <div className="analytics-charts">
        <Chart title="Synthetic new businesses by month" points={monthlyPoints(data.synthetic.series.new_businesses, "businesses")} kind="monthly" unit="synthetic business records" />
        <YearlyChart title="Synthetic new businesses by calendar year" points={yearlyPoints(data.synthetic.series.new_businesses, "businesses")} unit="synthetic business records" />
        <Chart title="Synthetic new memberships by week" points={weeklyPoints(data.synthetic.weekly_series.memberships, "memberships")} kind="weekly" unit="synthetic membership records" />
      </div>
    </details>
  </div>;
}
