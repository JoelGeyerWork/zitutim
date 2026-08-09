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
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname,
  useRouter: () => ({ refresh }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  usePathname.mockReturnValue("/");
  fetchMock = vi.fn().mockImplementation(respondWith(null, 204));
  vi.stubGlobal("fetch", fetchMock);
});

describe("AccountMenu — signed out", () => {
  it("offers a login link", () => {
    // No provider at all: the context defaults to null, which is the same state
    // an anonymous visitor sees.
    render(<AccountMenu />);

    expect(screen.getByRole("link", { name: "כניסה" })).toBeInTheDocument();
  });

  it("returns you to the page you were on", () => {
    usePathname.mockReturnValue("/search");
    render(<AccountMenu />);

    expect(screen.getByRole("link", { name: "כניסה" })).toHaveAttribute(
      "href",
      "/login?next=%2Fsearch",
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

  it("posts to the logout endpoint and refreshes", async () => {
    const user = userEvent.setup();
    renderSignedIn();

    await user.click(screen.getByRole("button", { name: "החשבון שלי" }));
    await user.click(await screen.findByRole("menuitem", { name: /יציאה/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
        method: "POST",
      }),
    );
    // A GET logout would be triggerable by an <img> tag on any page.
    // The refresh is what swaps the menu back to "כניסה".
    expect(refresh).toHaveBeenCalled();
  });
});
