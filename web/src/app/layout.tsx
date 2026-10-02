import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "../components/theme";

// The landing page's type pair. globals.css maps --font-bodoni to --font-display and uses Jost as body.
const display = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], variable: "--font-bodoni", display: "swap" });
const body = Jost({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jost", display: "swap" });

export const metadata: Metadata = {
  title: "Drezivo Operator",
  description: "Internal operations console for Drezivo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    // The theme script sets data-theme on <html> before hydration, so <html> skips that attribute check.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
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
