"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes needs a client boundary, and the root layout is a server
 * component — hence this thin wrapper.
 */
export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
