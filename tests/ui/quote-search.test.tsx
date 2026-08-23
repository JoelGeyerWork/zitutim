import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteSearch } from "@/components/quote-search";
import { makeQuote, respondWith } from "./factories";
import type { Quote, QuotePage } from "@/lib/quote-schema";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes/search",
  useRouter: () => ({ refresh: vi.fn() }),
}));

function page(quotes: Quote[], overrides: Partial<QuotePage> = {}): QuotePage {
  return { quotes, total: quotes.length, hasMore: false, ...overrides };
}

const DANA = makeQuote({ id: "1", author: "דנה" });
const OMER = makeQuote({
  id: "2",
  author: "עומר",
  text: "בואו נדחה את זה לספרינט הבא",
});

let fetchMock: ReturnType<typeof vi.fn>;

/** The URLs every fetch was called with, in order. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(respondWith(page([DANA, OMER])));
  vi.stubGlobal("fetch", fetchMock);
});

describe("QuoteSearch", () => {
  it("loads every quote before anything is typed", async () => {
    render(<QuoteSearch />);

    expect(await screen.findByText(OMER.text)).toBeInTheDocument();
    expect(screen.getByText("2 ציטוטים בקיר")).toBeInTheDocument();
    expect(requestedUrls()[0]).not.toContain("q=");
  });

  it("sends the typed term as ?q=", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    fetchMock.mockImplementation(respondWith(page([OMER])));
    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "נדחה");

    await waitFor(() =>
      expect(requestedUrls().at(-1)).toContain(`q=${encodeURIComponent("נדחה")}`),
    );
  });

  it("debounces typing into a single request", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);
    fetchMock.mockClear();

    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "נדחה");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Four keystrokes must not mean four round trips.
    expect(fetchMock.mock.calls.length).toBeLessThan(4);
  });

  it("summarises the result count in Hebrew, singular included", async () => {
    fetchMock.mockImplementation(respondWith(page([OMER])));
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "נדחה");
    expect(
      await screen.findByText('תוצאה אחת עבור ״נדחה״'),
    ).toBeInTheDocument();
  });

  it("highlights the matched term in the results", async () => {
    fetchMock.mockImplementation(respondWith(page([OMER])));
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "נדחה");
    await waitFor(() => {
      const mark = document.querySelector("mark");
      expect(mark?.textContent).toBe("נדחה");
    });
  });

  it("shows an empty state naming the term", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    fetchMock.mockImplementation(respondWith(page([])));
    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "בלתי אפשרי");

    expect(
      await screen.findByText(/אין תוצאות ל״בלתי אפשרי״/),
    ).toBeInTheDocument();
  });

  it("clears the term with the clear button and reloads everything", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    const input = screen.getByLabelText("חיפוש ציטוטים");
    await user.type(input, "נדחה");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ניקוי החיפוש" })).toBeVisible(),
    );

    await user.click(screen.getByRole("button", { name: "ניקוי החיפוש" }));
    expect(input).toHaveValue("");
    await waitFor(() => expect(requestedUrls().at(-1)).not.toContain("q="));
  });

  it("has no clear button until something is typed", async () => {
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);
    expect(screen.queryByRole("button", { name: "ניקוי החיפוש" })).toBeNull();
  });

  it("requests the chosen sort", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    await user.click(screen.getByRole("combobox", { name: "מיון" }));
    await user.click(await screen.findByRole("option", { name: "לפי שם הדובר" }));

    await waitFor(() => expect(requestedUrls().at(-1)).toContain("sort=author"));
  });

  it("keeps the term when the sort changes", async () => {
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);

    await user.type(screen.getByLabelText("חיפוש ציטוטים"), "נדחה");
    await waitFor(() => expect(requestedUrls().at(-1)).toContain("q="));

    await user.click(screen.getByRole("combobox", { name: "מיון" }));
    await user.click(await screen.findByRole("option", { name: "מהחדש לישן" }));

    await waitFor(() => {
      const url = requestedUrls().at(-1)!;
      expect(url).toContain("sort=recent");
      expect(url).toContain("q=");
    });
  });

  it("appends the next page without duplicating what is on screen", async () => {
    fetchMock.mockImplementation(
      respondWith(page([DANA], { total: 2, hasMore: true })),
    );
    const user = userEvent.setup();
    render(<QuoteSearch />);
    await screen.findByText(DANA.text);

    // The server repeats DANA alongside the new quote; it must appear once.
    fetchMock.mockImplementation(
      respondWith(page([DANA, OMER], { total: 2, hasMore: false })),
    );
    await user.click(screen.getByRole("button", { name: "עוד תוצאות" }));

    expect(await screen.findByText(OMER.text)).toBeInTheDocument();
    expect(screen.getAllByText(DANA.text)).toHaveLength(1);
    expect(requestedUrls().at(-1)).toContain("skip=1");
  });

  it("offers no load-more button when the page is complete", async () => {
    render(<QuoteSearch />);
    await screen.findByText(OMER.text);
    expect(screen.queryByRole("button", { name: "עוד תוצאות" })).toBeNull();
  });

  it("reports a failed search instead of hanging on the skeleton", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<QuoteSearch />);

    expect(await screen.findByText(/אין עדיין ציטוטים/)).toBeInTheDocument();
  });
});
