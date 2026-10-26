import type { ReactNode } from "react";
import { formatManila } from "@/shared/lib/format";
import { EmptyPanel } from "./StatePanels";
import { StatusBadge } from "./StatusBadge";

export type RecordRow = Record<string, unknown>;
export function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function recordRows(data: unknown): RecordRow[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items) ? items : [data as RecordRow];
}
export function renderRecordCell(value: unknown, column: string): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="muted">-</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <span className="muted">Structured value</span>;
  if (typeof value === "string" && ["status", "state"].includes(column.toLowerCase())) return <StatusBadge value={value} />;
  if (typeof value === "string" && /^\d{4}-\d\d-\d\d/.test(value)) return formatManila(value, true);
  return String(value);
}
/** Feature modules supply their own columns, links, and row actions. */
export function RecordTable({ data, columns, labels = {}, cell, action }: {
  data: unknown; columns?: string[]; labels?: Record<string, string>;
  cell?: (row: RecordRow, column: string) => ReactNode; action?: (row: RecordRow) => ReactNode;
}) {
  const rows = recordRows(data);
  if (rows.length === 0) return <EmptyPanel />;
  const keys = columns?.filter((column) => rows.some((row) => column in row))
    ?? [...new Set(rows.flatMap(Object.keys))].filter((key) => !["metadata", "permissions", "capabilities", "raw_payload"].includes(key)).slice(0, 7);
  return <div className="table-wrap"><table><thead><tr>{keys.map((key) => <th key={key}>{labels[key] ?? formatLabel(key)}</th>)}{action && <th>Action</th>}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={String(row.id || row.job_id || row.delivery_id || row.operator_id || row.tenant_id || index)}>
      {keys.map((key) => <td key={key}>{cell ? cell(row, key) : renderRecordCell(row[key], key)}</td>)}{action && <td>{action(row)}</td>}
    </tr>)}
  </tbody></table></div>;
}
