import type { Metadata } from "next";
import { LocalOperatorProvider } from "../lib/local-auth";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "../components/theme";

// The landing page's type pair. globals.css maps --font-bodoni to --font-display and uses Jost as body.
const display = localFont({ src: [{path:"./fonts/bodoni.woff2",weight:"400 900",style:"normal"},{path:"./fonts/bodoni-italic.woff2",weight:"400 900",style:"italic"}], variable:"--font-bodoni", display:"swap" });
const body = localFont({src:"./fonts/jost.woff2",weight:"400 600",variable:"--font-jost",display:"swap"});

export const metadata: Metadata = {
  title: "Drezivo Operator",
  description: "Internal operations console for Drezivo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const isLocalOperator = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_OPERATOR_LOCAL_MODE === "true";
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    // The theme script sets data-theme on <html> before hydration, so <html> skips that attribute check.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {isLocalOperator ? <LocalOperatorProvider>{children}</LocalOperatorProvider> : publishableKey ? (
          <ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in">
            {children}
          </ClerkProvider>
        ) : children}
      </body>
    </html>
  );
}
