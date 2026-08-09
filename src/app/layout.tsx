import type { Metadata } from "next";
import { Heebo } from "next/font/google";

import { SessionProvider } from "@/components/session-provider";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getSession } from "@/lib/session";

import "./globals.css";

const heebo = Heebo({
  variable: "--font-sans",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ציטוטים",
  description: "קיר הציטוטים של הצוות — מי אמר, מתי, ולמה זה נשאר איתנו",
};

/**
 * Reading the session here opts every route into dynamic rendering, which is
 * the real cost of sharing it through context. It buys one verification per
 * request for the whole tree, and it is only a JWT check — no database hit on
 * the public read path.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSession();

  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
      // next-themes writes the theme class here before hydration.
      suppressHydrationWarning
    >
      {/* Light mode tints the page behind the cards; dark mode inverts the
          elevation, so cards stay lighter than the page instead. */}
      <body className="bg-muted/40 dark:bg-background flex min-h-full flex-col">
        <ThemeProvider>
          <SessionProvider user={user}>
            <SiteNav />
            <main className="flex-1 pb-24 md:pb-10">{children}</main>
            <Toaster position="top-center" richColors closeButton />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
