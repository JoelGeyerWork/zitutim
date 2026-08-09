import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";
import { SessionProvider } from "@/components/session-provider";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";

// next/font is a compiler transform; outside Next it has to be stubbed.
vi.mock("next/font/google", () => ({
  Heebo: () => ({ variable: "--font-sans" }),
}));

// getSession reaches for next/headers, which needs a real request scope.
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => null) }));

/** Every component type between the root of `tree` and `target`, inclusive. */
function ancestorsOf(tree: ReactNode, target: unknown): unknown[] | null {
  if (!isValidElement(tree)) return null;
  if (tree.type === target) return [];

  const { children } = tree.props as { children?: ReactNode };
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = ancestorsOf(child, target);
    if (found) return [tree.type, ...found];
  }
  return null;
}

describe("RootLayout", () => {
  // The toggle degrades silently outside the provider — next-themes hands back
  // an inert setter rather than throwing — so nothing else would catch the nav
  // being hoisted above <ThemeProvider>, a natural-looking edit since the nav
  // is a sibling of <main>.
  it("keeps the nav under the ThemeProvider", async () => {
    const tree = await RootLayout({ children: null } as never);

    expect(ancestorsOf(tree, SiteNav)).toContain(ThemeProvider);
  });

  it("keeps the nav under the SessionProvider", async () => {
    // The account menu reads the session from context, and degrades to the
    // signed-out state rather than throwing when there is no provider — so
    // nothing else would catch the nav being hoisted above it.
    const tree = await RootLayout({ children: null } as never);

    expect(ancestorsOf(tree, SiteNav)).toContain(SessionProvider);
  });

  it("lets next-themes write the theme class without a hydration warning", async () => {
    const tree = await RootLayout({ children: null } as never);

    // The class is written on <html> before React hydrates, so the server
    // markup can't match — suppressing it is what keeps the console clean.
    expect((tree as { props: Record<string, unknown> }).props)
      .toHaveProperty("suppressHydrationWarning", true);
  });
});
