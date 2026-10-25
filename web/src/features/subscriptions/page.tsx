"use client";
import { PagedResource } from "@/shared/api/ApiResource";
import { ApiError } from "@/shared/api/client";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { SubscriptionsPanel } from "./components/SubscriptionsPanel";
import { isSubscriptionPage } from "./model";

function parse(data: unknown, requestId: string) {
  if (!isSubscriptionPage(data)) throw new ApiError("The Operator API returned invalid subscriptions data.", "invalid_response", undefined, "INVALID_RESPONSE", requestId);
  return data;
}
export function SubscriptionsPage() {
  return <ConsolePage feature="subscriptions"><PagedResource path="/subscriptions?limit=25" parse={parse} dependency="Business API">
    {(data, pagination) => <SubscriptionsPanel data={data} {...pagination} />}
  </PagedResource></ConsolePage>;
}
