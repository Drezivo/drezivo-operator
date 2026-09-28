import { SignIn } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <BrandMark />
          <p className="eyebrow">Drezivo operator</p>
          <h1>Sign-in setup required</h1>
          <p>Add the Clerk publishable key to your local environment to enable operator sign-in.</p>
          <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>
        </div>
      </main>
    );
  }

  return (
    <main className="signin-screen">
      <div className="signin-intro">
        <BrandMark />
        <p className="eyebrow">Drezivo operator</p>
        <h1>Operations, with context.</h1>
        <p>Sign in with your operator account to access platform records and support tools.</p>
        <div className="signin-security"><span aria-hidden="true">✓</span> Access is verified by the operator API</div>
      </div>
      <div className="signin-box">
        <SignIn path="/sign-in" routing="path" forceRedirectUrl="/" fallbackRedirectUrl="/" />
      </div>
    </main>
  );
}
