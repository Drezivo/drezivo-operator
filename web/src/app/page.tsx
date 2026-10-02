import { Suspense } from "react";
import { AuthenticatedConsole } from "@/components/AuthenticatedConsole";
import { BrandMark } from "@/components/BrandMark";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <BrandMark />
          <p className="eyebrow">Drezivo operator</p>
          <h1>Sign-in setup required</h1>
          <p>Add the Clerk publishable key to your local environment to enable operator sign-in. No dashboard data is shown until authentication is configured.</p>
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>
        </div>
      </main>
    );
  }

  return (
    <Suspense fallback={<main className="setup-screen"><div className="loading-panel" role="status">Loading operator console…</div></main>}>
      <AuthenticatedConsole />
    </Suspense>
  );
}
