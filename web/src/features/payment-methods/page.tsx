"use client";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { PaymentMethodsPanel } from "./components/PaymentMethodsPanel";

export function PaymentMethodsPage() {
  const { getToken } = useOperatorAuth();
  return <ConsolePage feature="payment-methods"><PaymentMethodsPanel getToken={getToken} /></ConsolePage>;
}
