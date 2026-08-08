import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteForm } from "@/components/quote-form";
import { makeQuote, respondWith } from "./factories";

// The factory must be self-contained — vi.mock is hoisted above the imports.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(respondWith(makeQuote(), 201));
  vi.stubGlobal("fetch", fetchMock);
});

/** Fills the required fields; the date input defaults to today already. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
  await user.type(screen.getByLabelText(/מי אמר/), "דנה");
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("QuoteForm — creating", () => {
  it("defaults the date to today", () => {
    render(<QuoteForm />);
    const today = new Date();
    const expected = new Date(
      today.getTime() - today.getTimezoneOffset() * 60_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(screen.getByLabelText(/מתי/)).toHaveValue(expected);
  });

  it("POSTs the filled values to /api/quotes", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init, body } = lastRequest();
    expect(url).toBe("/api/quotes");
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({ text: "משהו שנאמר", author: "דנה" });
  });

  it("blocks submission and names the missing fields in Hebrew", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("צריך לכתוב מה נאמר")).toBeInTheDocument();
    expect(screen.getByText("צריך לציין מי אמר")).toBeInTheDocument();
  });

  it("clears a field's error as soon as it is edited", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));
    expect(await screen.findByText("צריך לציין מי אמר")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/מי אמר/), "ד");
    expect(screen.queryByText("צריך לציין מי אמר")).not.toBeInTheDocument();
    expect(screen.getByText("צריך לכתוב מה נאמר")).toBeInTheDocument();
  });

  it("renders server-side field errors from a 422", async () => {
    fetchMock.mockImplementation(
      respondWith(
        { error: "יש שדות לא תקינים", issues: { saidAt: "התאריך בעתיד" } },
        422,
      ),
    );

    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    expect(await screen.findByText("התאריך בעתיד")).toBeInTheDocument();
  });

  it("resets the fields after a successful save", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/מה נאמר/)).toHaveValue(""),
    );
    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("");
  });

  it("hands the saved quote to onSuccess", async () => {
    const onSuccess = vi.fn();
    const saved = makeQuote({ id: "6a000000000000000000000f" });
    fetchMock.mockImplementation(respondWith(saved, 201));

    const user = userEvent.setup();
    render(<QuoteForm onSuccess={onSuccess} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: saved.id }),
      ),
    );
  });

  it("does not call onSuccess when the request fails", async () => {
    const onSuccess = vi.fn();
    fetchMock.mockImplementation(respondWith({ error: "נפל" }, 500));

    const user = userEvent.setup();
    render(<QuoteForm onSuccess={onSuccess} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("survives the network being down", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    // Still interactive, values intact, ready for a retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "הוספה לקיר" })).toBeEnabled(),
    );
    expect(screen.getByLabelText(/מה נאמר/)).toHaveValue("משהו שנאמר");
    expect(toast.error).toHaveBeenCalledWith("אין חיבור לשרת");
  });

  it("confirms the save with a toast", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("הציטוט נוסף לקיר"),
    );
  });
});

describe("QuoteForm — remembering who is adding", () => {
  it("pre-fills the submitter from localStorage", () => {
    localStorage.setItem("zitutim:added-by", "יואל");
    render(<QuoteForm />);
    expect(screen.getByLabelText(/מי מוסיף/)).toHaveValue("יואל");
  });

  it("remembers the name after a successful save", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.type(screen.getByLabelText(/מי מוסיף/), "נועה");
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(localStorage.getItem("zitutim:added-by")).toBe("נועה"),
    );
  });

  it("keeps the name in the field after the form resets", async () => {
    localStorage.setItem("zitutim:added-by", "יואל");
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/מה נאמר/)).toHaveValue(""),
    );
    expect(screen.getByLabelText(/מי מוסיף/)).toHaveValue("יואל");
  });

  it("does not remember a blank name", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(localStorage.getItem("zitutim:added-by")).toBeNull();
  });
});

describe("QuoteForm — editing", () => {
  const quote = makeQuote({ context: "לפני הריטרו", addedBy: "יואל" });

  it("pre-fills every field from the quote", () => {
    render(<QuoteForm quote={quote} />);

    expect(screen.getByLabelText(/מה נאמר/)).toHaveValue(quote.text);
    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("דנה");
    expect(screen.getByLabelText(/מתי/)).toHaveValue("2026-07-28");
    expect(screen.getByLabelText(/הקשר/)).toHaveValue("לפני הריטרו");
    expect(screen.getByLabelText(/מי מוסיף/)).toHaveValue("יואל");
  });

  it("PUTs to the quote's own endpoint", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respondWith(quote));
    render(<QuoteForm quote={quote} />);

    await user.clear(screen.getByLabelText(/מה נאמר/));
    await user.type(screen.getByLabelText(/מה נאמר/), "ניסוח מתוקן");
    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init, body } = lastRequest();
    expect(url).toBe(`/api/quotes/${quote.id}`);
    expect(init.method).toBe("PUT");
    expect(body.text).toBe("ניסוח מתוקן");
  });

  it("keeps the edited values on screen after saving", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respondWith(quote));
    render(<QuoteForm quote={quote} />);

    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("דנה");
  });

  it("shows a cancel button only when a handler is given", async () => {
    const onCancel = vi.fn();
    const { rerender } = render(<QuoteForm quote={quote} />);
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();

    rerender(<QuoteForm quote={quote} onCancel={onCancel} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "ביטול" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
