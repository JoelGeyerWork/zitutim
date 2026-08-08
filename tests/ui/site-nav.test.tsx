import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SiteNav } from "@/components/site-nav";

const usePathname = vi.hoisted(() => vi.fn(() => "/"));
vi.mock("next/navigation", () => ({ usePathname }));

/** The nav renders twice (desktop bar + mobile bar); scope to the desktop one. */
function desktopNav() {
  return within(screen.getByRole("banner"));
}

describe("SiteNav", () => {
  it("links to all three pages", () => {
    render(<SiteNav />);
    const nav = desktopNav();

    expect(nav.getByRole("link", { name: /פיד/ })).toHaveAttribute("href", "/");
    expect(nav.getByRole("link", { name: /חיפוש/ })).toHaveAttribute(
      "href",
      "/search",
    );
    expect(nav.getByRole("link", { name: /ציטוט חדש/ })).toHaveAttribute(
      "href",
      "/create",
    );
  });

  it.each([
    ["/", "פיד"],
    ["/search", "חיפוש"],
    ["/create", "ציטוט חדש"],
  ])("marks %s as the current page", (pathname, label) => {
    usePathname.mockReturnValue(pathname);
    render(<SiteNav />);

    const current = desktopNav().getByRole("link", {
      name: new RegExp(label),
    });
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("marks only one page as current at a time", () => {
    usePathname.mockReturnValue("/search");
    render(<SiteNav />);

    const currents = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    // One in the desktop bar, one in the mobile bar — same destination.
    expect(currents).toHaveLength(2);
    expect(new Set(currents.map((link) => link.getAttribute("href")))).toEqual(
      new Set(["/search"]),
    );
  });

  it("always links the wordmark home", () => {
    usePathname.mockReturnValue("/create");
    render(<SiteNav />);
    expect(desktopNav().getByRole("link", { name: /ציטוטים/ })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
