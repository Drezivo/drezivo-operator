import type { Metadata } from "next";
import { LocalOperatorProvider } from "@/shared/auth/local-auth";
import { ClerkProvider } from "@clerk/nextjs";
import localFont from "next/font/local";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/shared/ui/theme";

// globals.css uses Playfair Display for display text and Jost for body text.
const display = localFont({ src: [{path:"./fonts/playfair-display.ttf",weight:"400 900",style:"normal"},{path:"./fonts/playfair-display-italic.ttf",weight:"400 900",style:"italic"}], variable:"--font-playfair", display:"swap" });
const body = localFont({src:"./fonts/jost.woff2",weight:"400 600",variable:"--font-jost",display:"swap"});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NODE_ENV === "production"
        ? "https://operator.drezivo.shop"
        : "http://localhost:3010",
  ),
  title: "Drezivo Operator",
  description: "Internal operations console for Drezivo.",
  openGraph: { images: ["/marketing/drezivo_logo.png"] },
  twitter: { card: "summary_large_image", images: ["/marketing/drezivo_logo.png"] },
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
