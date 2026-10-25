export const OPERATOR_TIME_ZONE = "Asia/Manila";

const dateTime = new Intl.DateTimeFormat("en-PH", { timeZone: OPERATOR_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-PH", { timeZone: OPERATOR_TIME_ZONE, dateStyle: "medium" });

/** Formats an instant in Manila time; every date on this screen uses the same zone. */
export function formatManila(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return (withTime ? dateTime : dateOnly).format(date);
}

/** A `<input type="date">` value (YYYY-MM-DD) means "until the end of that day in Manila". */
export function endOfManilaDay(dateInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const iso = `${dateInput}T23:59:59+08:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** YYYY-MM-DD for the Manila calendar day `days` after `from`. */
export function manilaDateInput(from: Date, days: number): string {
  const shifted = new Date(from.getTime() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: OPERATOR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
  return parts;
}

/** Days left until an instant, rounded up; negative once it has passed. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - now.getTime()) / 86_400_000);
}

/** A peso amount from minor units, for display only. */
export function formatPeso(amountMinor: string, currency = "PHP"): string {
  const value = Number(amountMinor) / 100;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);
}
