"use client";
import { useState } from "react";
import { ApiResource } from "@/shared/api/ApiResource";
import { useSessionToken } from "@/shared/auth/use-session-token";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { EmptyPanel } from "@/shared/ui/StatePanels";
import { BusinessSelect } from "@/features/clients/components/BusinessSelect";
import { EntitlementsPanel } from "./components/EntitlementsPanel";

export function AssignedPlansPage() {
  const [business, setBusiness] = useState("");
  const token = useSessionToken();
  return <ConsolePage feature="entitlements" picker={<div className="business-picker"><BusinessSelect token={token} value={business} onChange={setBusiness} required /></div>}>
    {!business ? <EmptyPanel title="Choose a business" body="Select a business by name above to review its plan and included capabilities." />
      : <ApiResource path={"/businesses/" + encodeURIComponent(business) + "/entitlements"} dependency="Business API">{(data) => <EntitlementsPanel data={data} />}</ApiResource>}
  </ConsolePage>;
}
