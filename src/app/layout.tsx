import type { Metadata } from "next";
import { Heebo } from "next/font/google";

import { SiteNav } from "@/components/site-nav";
import { Toaster } from "@/components/ui/sonner";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${heebo.variable} h-full antialiased`}
    >
      <body className="bg-muted/40 flex min-h-full flex-col">
        <SiteNav />
        <main className="flex-1 pb-24 md:pb-10">{children}</main>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
