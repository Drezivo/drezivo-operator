import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "../components/theme";

export const metadata: Metadata = {
  title: "Drezivo Operator",
  description: "Internal operations console for Drezivo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    // The theme script sets data-theme on <html> before hydration, so <html> skips that attribute check.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {publishableKey ? (
          <ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in">
            {children}
          </ClerkProvider>
        ) : children}
      </body>
    </html>
  );
}
