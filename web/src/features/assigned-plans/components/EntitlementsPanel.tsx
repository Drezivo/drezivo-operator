import { EmptyPanel } from "@/shared/ui/StatePanels";
import { formatLabel } from "@/shared/ui/RecordTable";
export function EntitlementsPanel({ data }: { data: unknown }) {
  const capabilities = (data as { capabilities?: Array<{ capability: string; enabled: boolean; limit_value: number | null }> })?.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) return <EmptyPanel title="No capabilities returned" body="The API returned no entitlement capabilities for this business." />;
  return <section className="capability-panel" aria-label="Business capabilities"><h2>Capabilities</h2><div className="table-wrap"><table><thead><tr><th>Capability</th><th>Status</th><th>Limit value</th></tr></thead><tbody>{capabilities.map((item) => <tr key={item.capability}><td>{formatLabel(item.capability.replaceAll(".", " ").replaceAll(":", " "))}<details className="technical-details"><summary>Capability code</summary>{item.capability}</details></td><td>{!item.enabled || item.limit_value === 0 ? "Not included" : "Included"}</td><td>{item.capability.endsWith(".enabled") || item.capability.startsWith("storefront_theme.") ? "-" : item.limit_value ?? "Not set"}</td></tr>)}</tbody></table></div></section>;
}
