"use client";

/** These choices map to the two implemented grant scopes; no editable permission-code text. */
export function AccessPermissions({ mode, onChange, disabled = false }: { mode: "read" | "repair"; onChange: (mode: "read" | "repair") => void; disabled?: boolean }) {
  return <fieldset className="access-permissions" disabled={disabled}>
    <legend>Permissions</legend>
    <label className="permission-choice permission-required"><input type="checkbox" checked disabled readOnly /><span><strong>View workspace records <small>Included</small></strong><span>Inspect clothing, stock, bookings, billing and operational records. Customer contact details and private evidence stay hidden.</span></span></label>
    <label className={`permission-choice ${mode === "repair" ? "permission-selected" : ""}`}><input type="checkbox" checked={mode === "repair"} onChange={event => onChange(event.target.checked ? "repair" : "read")} /><span><strong>Allow corrections and clothing deletion</strong><span>Correct encoding mistakes and permanently delete unused clothing after a dependency check and confirmation.</span></span></label>
    <p className="field-hint">{mode === "repair" ? "Repair access selected. Changes are attributed to your Superadmin account." : "Read-only access selected. You can inspect records but cannot change or delete them."}</p>
  </fieldset>;
}
