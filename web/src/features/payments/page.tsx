"use client";
import { useRouter } from "next/navigation";
import { useOperatorAuth } from "@/shared/auth/local-auth";
import { clientHref } from "@/shared/navigation/resources";
import { ConsolePage } from "@/shared/shell/ConsolePage";
import { useConsoleNavigation } from "@/shared/shell/console-controls";
import { PaymentsPanel } from "./components/PaymentReview";

export function PaymentsPage() {
  const { getToken } = useOperatorAuth();
  const router = useRouter();
  const remember = useConsoleNavigation();
  return <ConsolePage feature="payments"><PaymentsPanel getToken={getToken} onOpenBusiness={(id) => { remember(); router.push(clientHref(id)); }} /></ConsolePage>;
}
