import { Suspense, type ReactNode } from "react";
import { ConsoleShell } from "@/shared/shell/ConsoleShell";
import { BrandMark } from "@/shared/ui/BrandMark";
import { LoadingPanel } from "@/shared/ui/StatePanels";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    && !(process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_OPERATOR_LOCAL_MODE === "true")) {
    return <main className="setup-screen"><div className="setup-card"><BrandMark /><p className="eyebrow">Drezivo operator</p><h1>Sign-in setup required</h1><p>Add the Clerk publishable key to your local environment to enable operator sign-in. No dashboard data is shown until authentication is configured.</p><code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code></div></main>;
  }
  return <ConsoleShell><Suspense fallback={<LoadingPanel />}>{children}</Suspense></ConsoleShell>;
}
