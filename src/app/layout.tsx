import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drezivo Operator",
  description: "Internal operations console for Drezivo.",
  icons: { icon: "/drezivo-mark.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  return (
    <html lang="en">
      <body>
        {publishableKey ? (
          <ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in">
            {children}
          </ClerkProvider>
        ) : children}
      </body>
    </html>
  );
}
