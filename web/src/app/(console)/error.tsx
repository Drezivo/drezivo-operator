"use client";
import { ApiError } from "@/shared/api/client";
import { StatePanel } from "@/shared/ui/StatePanels";

export default function ConsoleError({ reset }: { reset: () => void }) {
  return <StatePanel error={new ApiError("This view could not be loaded. Try again.", "http")} onRetry={reset} />;
}
