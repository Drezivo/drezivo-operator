export type AnalyticsMonthPoint = { month: string; count: number };
export type AnalyticsWeekPoint = { week: string; count: number };
export type AnalyticsSeries = {
  new_businesses: AnalyticsMonthPoint[];
  memberships: AnalyticsMonthPoint[];
  subscription_events: Array<AnalyticsMonthPoint & { event_type: "trial_started" | "past_due" | "restricted" | "plan_changed" }>;
};
export type AnalyticsWeeklySeries = {
  new_businesses: AnalyticsWeekPoint[];
  memberships: AnalyticsWeekPoint[];
  subscription_events: Array<AnalyticsWeekPoint & { event_type: "trial_started" | "past_due" | "restricted" | "plan_changed" }>;
};
export type AnalyticsForecast = { horizon_months: 1 | 3 | 6 | 12; points?: AnalyticsMonthPoint[]; withheld_reason?: "insufficient_history" | "baseline_not_beaten" };
export type AnalyticsRunRate = Array<{ currency: string; amount_minor: string; active_subscription_count: number }>;
export type AnalyticsResponse = {
  as_of: string;
  timezone: "Asia/Manila";
  period: { from: string; to: string; months: 12 | 24 | 36 | 48 };
  weekly_period: { from: string; to: string; weeks: 52 };
  businesses: { total: number };
  subscriptions: { active: number; trialing: number; past_due: number; restricted: number; cancelled: number };
  members: { provisioned: number };
  active_plan_monthly_list_price_run_rate: AnalyticsRunRate;
  series: AnalyticsSeries;
  weekly_series: AnalyticsWeeklySeries;
  forecasts: {
    new_businesses: AnalyticsForecast[];
    memberships: AnalyticsForecast[];
    active_subscribers: { withheld_reason: "incomplete_history" };
    monthly_list_price_run_rate: { withheld_reason: "incomplete_history" };
  };
  synthetic: {
    businesses: { total: number };
    subscriptions: AnalyticsResponse["subscriptions"];
    members: { provisioned: number };
    series: AnalyticsSeries;
    weekly_series: AnalyticsWeeklySeries;
    active_plan_monthly_list_price_run_rate: AnalyticsRunRate;
  };
};

const supportedMonths = [12, 24, 36, 48] as const;
const horizons = [1, 3, 6, 12] as const;
const eventTypes = ["trial_started", "past_due", "restricted", "plan_changed"] as const;
const dayMs = 86_400_000;
const manilaOffsetMs = 8 * 60 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(row: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(row);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(row, key));
}
function count(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0; }
function month(value: unknown): value is string { return typeof value === "string" && /^(\d{4})-(0[1-9]|1[0-2])$/.test(value); }
function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const date = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  if (monthNumber < 1 || monthNumber > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date >= 1 && date <= days[monthNumber - 1]! && Number.isFinite(Date.parse(value));
}
function monthKey(year: number, monthNumber: number): string {
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(value: string): string {
  const [year, monthNumber] = value.split("-").map(Number);
  return monthKey(year!, monthNumber! + 1);
}
function isoWeekMonday(year: number, weekNumber: number): number {
  const januaryFourth = Date.UTC(year, 0, 4);
  const weekday = new Date(januaryFourth).getUTCDay() || 7;
  return januaryFourth - (weekday - 1) * dayMs + (weekNumber - 1) * 7 * dayMs;
}
function isoWeekForMonday(monday: number): string {
  const thursday = new Date(monday + 3 * dayMs);
  const weekYear = thursday.getUTCFullYear();
  const firstMonday = isoWeekMonday(weekYear, 1);
  const weekNumber = Math.floor((monday - firstMonday) / (7 * dayMs)) + 1;
  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}
function validWeek(value: string): boolean {
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value);
  return !!match && isoWeekForMonday(isoWeekMonday(Number(match[1]), Number(match[2]))) === value;
}
function nextWeek(value: string): string {
  const [yearText, weekText] = value.split("-W");
  return isoWeekForMonday(isoWeekMonday(Number(yearText), Number(weekText)) + 7 * dayMs);
}
function manilaMonthBoundary(value: string): string | null {
  if (!instant(value)) return null;
  const local = new Date(Date.parse(value) + manilaOffsetMs);
  if (local.getUTCDate() !== 1 || local.getUTCHours() !== 0 || local.getUTCMinutes() !== 0 || local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0) return null;
  return monthKey(local.getUTCFullYear(), local.getUTCMonth() + 1);
}
function manilaWeekBoundary(value: string): string | null {
  if (!instant(value)) return null;
  const local = new Date(Date.parse(value) + manilaOffsetMs);
  if (local.getUTCDay() !== 1 || local.getUTCHours() !== 0 || local.getUTCMinutes() !== 0 || local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0) return null;
  return isoWeekForMonday(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}
function monthlyWindow(periodValue: unknown): string[] | null {
  const period = record(periodValue);
  if (!period || !exact(period, ["from", "to", "months"]) || !instant(period.from) || !instant(period.to)
    || !supportedMonths.includes(period.months as typeof supportedMonths[number]) || Date.parse(period.from) >= Date.parse(period.to)) return null;
  const firstMonth = manilaMonthBoundary(period.from);
  const lastMonth = manilaMonthBoundary(period.to);
  if (!firstMonth || !lastMonth) return null;
  const [year, monthNumber] = firstMonth.split("-").map(Number);
  const toBoundary = Date.UTC(year!, monthNumber! - 1 + Number(period.months), 1) - manilaOffsetMs;
  if (Date.parse(period.to) !== toBoundary) return null;
  const values = Array.from({ length: Number(period.months) }, (_, index) => monthKey(year!, monthNumber! + index));
  return nextMonth(values.at(-1)!) === lastMonth ? values : null;
}
function weeklyWindow(periodValue: unknown): string[] | null {
  const period = record(periodValue);
  if (!period || !exact(period, ["from", "to", "weeks"]) || !instant(period.from) || !instant(period.to)
    || period.weeks !== 52 || Date.parse(period.from) >= Date.parse(period.to)
    || Date.parse(period.to) - Date.parse(period.from) !== 52 * 7 * dayMs) return null;
  const firstWeek = manilaWeekBoundary(period.from);
  const lastWeek = manilaWeekBoundary(period.to);
  if (!firstWeek || !lastWeek) return null;
  const values = [firstWeek];
  while (values.length < 52) values.push(nextWeek(values.at(-1)!));
  return nextWeek(values.at(-1)!) === lastWeek ? values : null;
}
function point(value: unknown): value is AnalyticsMonthPoint {
  const parsed = record(value);
  return !!parsed && exact(parsed, ["month", "count"]) && month(parsed.month) && count(parsed.count);
}
function points(value: unknown): value is AnalyticsMonthPoint[] { return Array.isArray(value) && value.every(point); }
function weekPoint(value: unknown): value is AnalyticsWeekPoint {
  const parsed = record(value);
  return !!parsed && exact(parsed, ["week", "count"]) && typeof parsed.week === "string" && validWeek(parsed.week) && count(parsed.count);
}
function weekPoints(value: unknown): value is AnalyticsWeekPoint[] { return Array.isArray(value) && value.every(weekPoint); }
function series(value: unknown): value is AnalyticsSeries {
  const parsed = record(value);
  if (!parsed || !exact(parsed, ["new_businesses", "memberships", "subscription_events"]) || !points(parsed.new_businesses) || !points(parsed.memberships)
    || !Array.isArray(parsed.subscription_events) || parsed.subscription_events.length > 192) return false;
  const seen = new Set<string>();
  return parsed.subscription_events.every((event) => {
      const row = record(event);
      if (!row || !exact(row, ["month", "event_type", "count"]) || !month(row.month) || !count(row.count)
        || !eventTypes.includes(row.event_type as typeof eventTypes[number])) return false;
      const key = `${row.month}:${row.event_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function weeklySeries(value: unknown): value is AnalyticsWeeklySeries {
  const parsed = record(value);
  if (!parsed || !exact(parsed, ["new_businesses", "memberships", "subscription_events"]) || !weekPoints(parsed.new_businesses) || !weekPoints(parsed.memberships)
    || parsed.new_businesses.length !== 52 || parsed.memberships.length !== 52
    || !Array.isArray(parsed.subscription_events) || parsed.subscription_events.length > 208) return false;
  const seen = new Set<string>();
  return parsed.subscription_events.every((event) => {
      const row = record(event);
      if (!row || !exact(row, ["week", "event_type", "count"]) || typeof row.week !== "string" || !validWeek(row.week) || !count(row.count)
        || !eventTypes.includes(row.event_type as typeof eventTypes[number])) return false;
      const key = `${row.week}:${row.event_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function runRate(value: unknown): value is AnalyticsRunRate {
  if (!Array.isArray(value) || value.length > 100) return false;
  const currencies = new Set<string>();
  return value.every((entry) => {
    const row = record(entry);
    if (!row || !exact(row, ["currency", "amount_minor", "active_subscription_count"])
      || typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency)
      || typeof row.amount_minor !== "string" || !/^(0|[1-9]\d*)$/.test(row.amount_minor)
      || row.amount_minor.length > 128
      || !count(row.active_subscription_count) || currencies.has(row.currency)) return false;
    currencies.add(row.currency);
    return true;
  });
}
function forecast(value: unknown, expectedHorizon: typeof horizons[number], expectedStartMonth: string): value is AnalyticsForecast {
  const row = record(value);
  if (!row || row.horizon_months !== expectedHorizon) return false;
  if (Array.isArray(row.points)) {
    if (!exact(row, ["horizon_months", "points"]) || row.points.length !== expectedHorizon || !points(row.points)
      || row.points[0]?.month !== expectedStartMonth) return false;
    for (let index = 1; index < row.points.length; index += 1) {
      if (row.points[index]!.month !== nextMonth(row.points[index - 1]!.month)) return false;
    }
    return true;
  }
  return exact(row, ["horizon_months", "withheld_reason"])
    && (row.withheld_reason === "insufficient_history" || row.withheld_reason === "baseline_not_beaten");
}
function lifecycle(value: unknown): value is AnalyticsResponse["subscriptions"] {
  const row = record(value);
  const keys = ["active", "trialing", "past_due", "restricted", "cancelled"];
  return !!row && exact(row, keys) && keys.every((key) => count(row[key]));
}
function analyticsShape(value: unknown): value is AnalyticsResponse {
  const row = record(value);
  if (!row || !exact(row, ["as_of", "timezone", "period", "weekly_period", "businesses", "subscriptions", "members", "active_plan_monthly_list_price_run_rate", "series", "weekly_series", "forecasts", "synthetic"])) return false;
  const period = record(row.period);
  const businesses = record(row.businesses);
  const members = record(row.members);
  const forecasts = record(row.forecasts);
  const synthetic = record(row.synthetic);
  const syntheticBusinesses = record(synthetic?.businesses);
  const syntheticMembers = record(synthetic?.members);
  const subscriberForecast = record(forecasts?.active_subscribers);
  const runRateForecast = record(forecasts?.monthly_list_price_run_rate);
  if (!instant(row.as_of) || row.timezone !== "Asia/Manila" || !period || !monthlyWindow(period) || !weeklyWindow(row.weekly_period)
    || !businesses || !exact(businesses, ["total"]) || !count(businesses.total) || !lifecycle(row.subscriptions)
    || !members || !exact(members, ["provisioned"]) || !count(members.provisioned) || !runRate(row.active_plan_monthly_list_price_run_rate)
    || !series(row.series) || !weeklySeries(row.weekly_series) || !forecasts
    || !exact(forecasts, ["new_businesses", "memberships", "active_subscribers", "monthly_list_price_run_rate"])) return false;
  const months = period.months as typeof supportedMonths[number];
  const monthKeys = monthlyWindow(period)!;
  const forecastStartMonth = typeof period.to === "string" ? manilaMonthBoundary(period.to) : null;
  if (!forecastStartMonth) return false;
  if (!monthlyValuesMatch(row.series, monthKeys) || !monthlyValuesMatch(synthetic?.series, monthKeys)
    || !weeklyValuesMatch(row.weekly_series, row.weekly_period) || !weeklyValuesMatch(synthetic?.weekly_series, row.weekly_period)) return false;
  if (!forecastList(forecasts.new_businesses, forecastStartMonth) || !forecastList(forecasts.memberships, forecastStartMonth)
    || !exact(subscriberForecast ?? {}, ["withheld_reason"]) || subscriberForecast?.withheld_reason !== "incomplete_history"
    || !exact(runRateForecast ?? {}, ["withheld_reason"]) || runRateForecast?.withheld_reason !== "incomplete_history") return false;
  if (!synthetic || !exact(synthetic, ["businesses", "subscriptions", "members", "series", "weekly_series", "active_plan_monthly_list_price_run_rate"])
    || !syntheticBusinesses || !exact(syntheticBusinesses, ["total"]) || !count(syntheticBusinesses.total) || !lifecycle(synthetic.subscriptions)
    || !syntheticMembers || !exact(syntheticMembers, ["provisioned"]) || !count(syntheticMembers.provisioned)
    || !series(synthetic.series) || !weeklySeries(synthetic.weekly_series) || !runRate(synthetic.active_plan_monthly_list_price_run_rate)) return false;
  return monthKeys.length === months;
}

function monthlyValuesMatch(value: unknown, window: string[]): boolean {
  const parsed = record(value);
  if (!parsed || !Array.isArray(parsed.new_businesses) || !Array.isArray(parsed.memberships) || !Array.isArray(parsed.subscription_events)) return false;
  const windowSet = new Set(window);
  return [parsed.new_businesses, parsed.memberships].every((items) => items.length === window.length
    && items.every((item, index) => point(item) && item.month === window[index]))
    && parsed.subscription_events.every((item) => {
      const event = record(item);
      return !!event && typeof event.month === "string" && windowSet.has(event.month);
    });
}
function weeklyValuesMatch(value: unknown, periodValue: unknown): boolean {
  const parsed = record(value);
  const window = weeklyWindow(periodValue);
  if (!parsed || !window || !Array.isArray(parsed.new_businesses) || !Array.isArray(parsed.memberships) || !Array.isArray(parsed.subscription_events)) return false;
  const windowSet = new Set(window);
  return [parsed.new_businesses, parsed.memberships].every((items) => items.length === 52
    && items.every((item, index) => weekPoint(item) && item.week === window[index]))
    && parsed.subscription_events.every((item) => {
      const event = record(item);
      return !!event && typeof event.week === "string" && windowSet.has(event.week);
    });
}
function forecastList(value: unknown, expectedStartMonth: string): boolean {
  return Array.isArray(value) && value.length === horizons.length && value.every((item, index) => forecast(item, horizons[index]!, expectedStartMonth));
}

export function parseAnalyticsResponse(value: unknown): AnalyticsResponse {
  if (!analyticsShape(value)) throw new Error("The operator API returned analytics in an unsupported format.");
  return value;
}

export function analyticsPath(months: number): string {
  if (!supportedMonths.includes(months as typeof supportedMonths[number])) throw new RangeError("Analytics history must be 12, 24, 36, or 48 months.");
  return `/analytics?months=${months}`;
}

export function formatMinorAmount(amountMinor: string, currency: string): string {
  const amount = BigInt(amountMinor);
  const fractionDigits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = BigInt(10) ** BigInt(fractionDigits);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(fractionDigits, "0");
  const parts = new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).formatToParts(whole);
  return parts.map((part) => part.type === "fraction" ? fraction : part.value).join("");
}
