import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";

const usePathname = vi.hoisted(() => vi.fn(() => "/"));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname,
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  // next-themes writes on the real <html>, which persists between tests.
  document.documentElement.className = "";
});

describe("SiteNav", () => {
  it("always links the wordmark home", () => {
    usePathname.mockReturnValue("/quotes/create");
    render(<SiteNav />);

    expect(screen.getByRole("link", { name: "מרכז הצוות" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the section's own tabs, with the current one marked", () => {
    usePathname.mockReturnValue("/meetups/themes");
    render(<SiteNav />);

    const tabs = within(screen.getByRole("navigation", { name: "ישבצ״ים" }));
    expect(tabs.getByRole("link", { name: "התור" })).toHaveAttribute(
      "href",
      "/meetups",
    );

    const current = tabs.getByRole("link", { name: "נושאי הכיבוד" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(
      tabs
        .getAllByRole("link")
        .filter((tab) => tab.getAttribute("aria-current") === "page"),
    ).toHaveLength(1);
  });

  it("shows the quote game as its own current tab", () => {
    usePathname.mockReturnValue("/quotes/game");
    render(<SiteNav />);

    const tabs = within(screen.getByRole("navigation", { name: "ציטוטים" }));
    expect(tabs.getByRole("link", { name: "מי אמר?" })).toHaveAttribute(
      "href",
      "/quotes/game",
    );
    expect(tabs.getByRole("link", { name: "מי אמר?" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("leaves the hub without a tab bar", () => {
    usePathname.mockReturnValue("/");
    render(<SiteNav />);

    expect(screen.queryByRole("navigation")).toBeNull();
  });

  // Base UI radio items do not close the menu on click, so the section links
  // pass closeOnClick. Without it the menu is left hanging over the page it
  // just navigated to — invisible in a render test, hence the explicit check.
  it("closes the section menu when a section is chosen", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/quotes");
    render(<SiteNav />);

    await user.click(screen.getByRole("button", { name: /ציטוטים/ }));
    const item = await screen.findByRole("menuitemradio", { name: "ישבצ״ים" });
    expect(item).toHaveAttribute("href", "/meetups");

    await user.click(item);
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  // next-themes' useTheme() falls back to an inert no-op setter when there is
  // no provider above it, so a mis-wired tree stays silent — the toggle still
  // renders and still opens, it just stops doing anything. Drive it through a
  // real provider so that the wiring, not only the markup, is covered.
  it("switches the theme from the header toggle", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <SiteNav />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ערכת נושא" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "כהה" }));

    expect(document.documentElement).toHaveClass("dark");
  });
});
