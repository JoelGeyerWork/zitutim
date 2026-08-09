import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteFeed } from "@/components/quote-feed";
import { SessionProvider } from "@/components/session-provider";
import { makeQuote, makeSessionUser, respondWith } from "./factories";
import type { Quote, QuotePage } from "@/lib/quote-schema";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function page(quotes: Quote[], overrides: Partial<QuotePage> = {}): QuotePage {
  return { quotes, total: quotes.length, hasMore: false, ...overrides };
}

const DANA = makeQuote({ id: "1", author: "דנה" });
const OMER = makeQuote({ id: "2", author: "עומר", text: "בואו נדחה את זה" });
const NOA = makeQuote({ id: "3", author: "נועה", text: "אין דבר קבוע" });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(respondWith(page([])));
  vi.stubGlobal("fetch", fetchMock);
});

describe("QuoteFeed", () => {
  it("renders the quotes it was given on the server", () => {
    render(<QuoteFeed initial={page([DANA, OMER])} />);

    expect(screen.getByText(DANA.text)).toBeInTheDocument();
    expect(screen.getByText(OMER.text)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invites the first quote when the wall is empty", () => {
    render(<QuoteFeed initial={page([])} />);

    expect(screen.getByText("הקיר עוד ריק")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /הוספת הציטוט הראשון/ }),
    ).toHaveAttribute("href", "/create");
  });

  it("marks the end of a complete feed with a Hebrew count", () => {
    render(<QuoteFeed initial={page([DANA, OMER])} />);
    expect(screen.getByText(/2 ציטוטים/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "עוד ציטוטים" })).toBeNull();
  });

  it("uses the singular wording for a wall of one", () => {
    render(<QuoteFeed initial={page([DANA])} />);
    expect(screen.getByText(/ציטוט אחד/)).toBeInTheDocument();
  });

  it("loads the next page on demand, skipping what is already shown", async () => {
    fetchMock.mockImplementation(respondWith(page([NOA], { total: 3 })));
    const user = userEvent.setup();
    render(<QuoteFeed initial={page([DANA, OMER], { total: 3, hasMore: true })} />);

    await user.click(screen.getByRole("button", { name: "עוד ציטוטים" }));

    expect(await screen.findByText(NOA.text)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain("skip=2");
  });

  it("never shows a quote twice if a page overlaps", async () => {
    // A quote added between requests shifts the offset, so the next page can
    // repeat one we already have.
    fetchMock.mockImplementation(
      respondWith(page([OMER, NOA], { total: 3 })),
    );
    const user = userEvent.setup();
    render(<QuoteFeed initial={page([DANA, OMER], { total: 3, hasMore: true })} />);

    await user.click(screen.getByRole("button", { name: "עוד ציטוטים" }));

    expect(await screen.findByText(NOA.text)).toBeInTheDocument();
    expect(screen.getAllByText(OMER.text)).toHaveLength(1);
  });

  it("stops offering more once the last page arrives", async () => {
    fetchMock.mockImplementation(
      respondWith(page([NOA], { total: 3, hasMore: false })),
    );
    const user = userEvent.setup();
    render(<QuoteFeed initial={page([DANA, OMER], { total: 3, hasMore: true })} />);

    await user.click(screen.getByRole("button", { name: "עוד ציטוטים" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "עוד ציטוטים" })).toBeNull(),
    );
    expect(screen.getByText(/הגעת לתחילת הקיר/)).toBeInTheDocument();
  });

  it("gives up gracefully when loading more fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<QuoteFeed initial={page([DANA], { total: 2, hasMore: true })} />);

    await user.click(screen.getByRole("button", { name: "עוד ציטוטים" }));

    // The quotes already on screen stay put.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "עוד ציטוטים" })).toBeNull(),
    );
    expect(screen.getByText(DANA.text)).toBeInTheDocument();
  });

  it("re-syncs when the server hands down a fresh page", () => {
    const { rerender } = render(<QuoteFeed initial={page([DANA, OMER])} />);
    expect(screen.getByText(OMER.text)).toBeInTheDocument();

    // router.refresh() after a delete elsewhere re-renders with new props.
    rerender(<QuoteFeed initial={page([DANA])} />);
    expect(screen.queryByText(OMER.text)).not.toBeInTheDocument();
    expect(screen.getByText(DANA.text)).toBeInTheDocument();
  });

  it("refreshes the list after a card is deleted", async () => {
    fetchMock.mockImplementation(respondWith(page([DANA])));
    const user = userEvent.setup();
    // The card's actions menu only renders for a signed-in user.
    render(
      <SessionProvider user={makeSessionUser()}>
        <QuoteFeed initial={page([DANA, OMER])} />
      </SessionProvider>,
    );

    const menus = screen.getAllByRole("button", { name: "אפשרויות נוספות" });
    await user.click(menus[1]);
    await user.click(await screen.findByRole("menuitem", { name: /מחיקה/ }));
    await user.click(
      await screen.findByRole("button", { name: "מחיקה", hidden: false }),
    );

    await waitFor(() =>
      expect(screen.queryByText(OMER.text)).not.toBeInTheDocument(),
    );
  });
});
