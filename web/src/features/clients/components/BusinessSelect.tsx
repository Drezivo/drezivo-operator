"use client";

import { useCachedLoad } from "@/shared/api/view-cache";
import { clientPaths } from "@/features/clients/api";
import { type ClientSummary } from "@/features/clients/model";

/** Business names are the primary selector. UUIDs stay in request values, never required from memory. */
export function BusinessSelect({ token, value, onChange, name = "tenant_id", label = "Business", required = false, disabled = false, emptyLabel = "Choose a business" }: {
  token: () => Promise<string>; value: string; onChange: (value: string) => void;
  name?: string; label?: string; required?: boolean; disabled?: boolean; emptyLabel?: string;
}) {
  const [state, reload] = useCachedLoad<{ items: ClientSummary[] }>(clientPaths.list, token);
  const items = state.status === "ready" && Array.isArray(state.data.items) ? [...state.data.items].sort((a, b) => a.name.localeCompare(b.name)) : [];
  return <div className="business-select-field"><label>{label}<select name={name} value={value} required={required} disabled={disabled || state.status !== "ready"} onChange={event => onChange(event.target.value)}>
    <option value="">{state.status === "loading" ? "Loading businesses…" : state.status === "error" ? "Businesses unavailable" : emptyLabel}</option>
    {value && !items.some(item => item.tenant_id === value) && <option value={value}>Selected business</option>}
    {items.map(item => <option key={item.tenant_id} value={item.tenant_id}>{item.name} · /s/{item.slug}</option>)}
  </select></label>{state.status === "error" && <p className="field-error" role="alert">Could not load businesses. <button type="button" className="text-button" onClick={() => void reload()}>Try again</button></p>}
  {state.status === "ready" && items.length === 0 && <p className="field-hint">Businesses appear after onboarding.</p>}</div>;
}
