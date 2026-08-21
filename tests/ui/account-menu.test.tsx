import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/account-menu";
import { SessionProvider } from "@/components/session-provider";
import { makeSessionUser, respondWith } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const usePathname = vi.hoisted(() => vi.fn(() => "/"));
vi.mock("next/navigation", () => ({ usePathname }));

let fetchMock: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  usePathname.mockReturnValue("/");
  fetchMock = vi.fn().mockImplementation(respondWith(null, 204));
  vi.stubGlobal("fetch", fetchMock);

  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
});

describe("AccountMenu — signed out", () => {
  it("offers a login link", () => {
    // No provider at all: the context defaults to null, which is the same state
    // an anonymous visitor sees.
    render(<AccountMenu />);

    expect(screen.getByRole("link", { name: "כניסה" })).toBeInTheDocument();
  });

  it("returns you to the page you were on", () => {
    usePathname.mockReturnValue("/quotes/search");
    render(<AccountMenu />);

    expect(screen.getByRole("link", { name: "כניסה" })).toHaveAttribute(
      "href",
      "/login?next=%2Fquotes%2Fsearch",
    );
  });
});

describe("AccountMenu — signed in", () => {
  function renderSignedIn() {
    return render(
      <SessionProvider user={makeSessionUser()}>
        <AccountMenu />
      </SessionProvider>,
    );
  }

  it("shows the display name and username in the menu", async () => {
    const user = userEvent.setup();
    renderSignedIn();

    await user.click(screen.getByRole("button", { name: "החשבון שלי" }));

    expect(await screen.findByText("דנה כהן")).toBeInTheDocument();
    expect(screen.getByText("dana")).toBeInTheDocument();
  });

  it("shows no login link", () => {
    renderSignedIn();
    expect(screen.queryByRole("link", { name: "כניסה" })).not.toBeInTheDocument();
  });

  it("posts to the logout endpoint and reloads", async () => {
    const user = userEvent.setup();
    renderSignedIn();

    await user.click(screen.getByRole("button", { name: "החשבון שלי" }));
    await user.click(await screen.findByRole("menuitem", { name: /יציאה/ }));

    // POST, because a GET logout is triggerable by an <img> tag on any page.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
      }),
    );
    // A reload, not router.refresh() — the Router Cache is still holding
    // signed-in renders of every route already visited.
    expect(reload).toHaveBeenCalled();
  });
});
