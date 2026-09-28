const successStatuses = new Set(["active", "enabled", "paid", "succeeded", "success", "completed", "complete", "delivered", "resolved", "healthy"]);
const warningStatuses = new Set(["trial", "trialing", "grace", "past_due", "pending", "retryable", "queued", "processing"]);
const dangerStatuses = new Set(["failed", "dead", "restricted", "cancelled", "disabled", "bounced", "expired", "revoked", "rejected"]);

export function formatStatusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = successStatuses.has(normalized)
    ? "success"
    : warningStatuses.has(normalized)
      ? "warning"
      : dangerStatuses.has(normalized)
        ? "danger"
        : "neutral";

  return <span className={`status-badge status-badge-${tone}`}><span aria-hidden="true" />{formatStatusLabel(value)}</span>;
}
