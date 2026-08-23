import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QuoteCard } from "@/components/quote-card";
import { SessionProvider } from "@/components/session-provider";
import { makeQuote, makeSessionUser } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes",
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

/** The actions menu only exists for a signed-in user. */
function renderSignedIn(ui: React.ReactElement) {
  return render(
    <SessionProvider user={makeSessionUser()}>{ui}</SessionProvider>,
  );
}

describe("QuoteCard", () => {
  it("shows the quote, the author and the Hebrew date it was said", () => {
    render(<QuoteCard quote={makeQuote()} />);

    expect(screen.getByText("תמיד יש זמן לעוד קפה אחד")).toBeInTheDocument();
    expect(screen.getByText("דנה")).toBeInTheDocument();
    expect(screen.getByText(/28 ביולי 2026/)).toBeInTheDocument();
  });

  it("renders the context only when there is one", () => {
    const { rerender } = render(<QuoteCard quote={makeQuote()} />);
    expect(screen.queryByText("לפני הריטרו")).not.toBeInTheDocument();

    rerender(<QuoteCard quote={makeQuote({ context: "לפני הריטרו" })} />);
    expect(screen.getByText("לפני הריטרו")).toBeInTheDocument();
  });

  it("credits whoever added it, when known", () => {
    render(<QuoteCard quote={makeQuote({ addedBy: "יואל" })} />);
    expect(screen.getByText("נוסף על ידי יואל")).toBeInTheDocument();
  });

  it("copies the quote and attribution to the clipboard", async () => {
    // setup() installs its own clipboard stub, so spy on it afterwards.
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(<QuoteCard quote={makeQuote()} />);
    await user.click(screen.getByRole("button", { name: /העתקה/ }));

    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(copied).toContain("דנה");
    expect(copied).toContain("28 ביולי 2026");

    expect(await screen.findByText("הועתק")).toBeInTheDocument();
  });

  it("highlights the search term without dropping any text", () => {
    render(<QuoteCard quote={makeQuote()} highlight="קפה" />);

    expect(screen.getByText("קפה").tagName).toBe("MARK");
    // Splitting on the term must not lose or duplicate any of the surrounding
    // text — the blockquote still reads exactly as stored.
    expect(document.querySelector("blockquote")?.textContent).toBe(
      "תמיד יש זמן לעוד קפה אחד",
    );
  });

  it("highlights every occurrence, case-insensitively", () => {
    render(
      <QuoteCard quote={makeQuote({ text: "Ship it, then ship it again" })} highlight="ship" />,
    );
    expect(screen.getAllByText(/ship/i).filter((el) => el.tagName === "MARK"))
      .toHaveLength(2);
  });

  it("treats a regex metacharacter in the term as literal text", () => {
    render(<QuoteCard quote={makeQuote({ text: "אמר .* בכוונה" })} highlight=".*" />);

    const marks = document.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe(".*");
  });

  it("opens the edit dialog from the actions menu", async () => {
    const user = userEvent.setup();
    renderSignedIn(<QuoteCard quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));
    await user.click(await screen.findByRole("menuitem", { name: /עריכה/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("עריכת ציטוט")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/מי אמר/)).toHaveValue("דנה");
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    renderSignedIn(<QuoteCard quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));
    await user.click(await screen.findByRole("menuitem", { name: /מחיקה/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("למחוק את הציטוט?")).toBeInTheDocument();
    expect(within(dialog).getByText(/דנה/)).toBeInTheDocument();
  });

  it("hides the actions menu when signed out", () => {
    // Presentation only — the API's 401 is what actually stops the edit.
    render(<QuoteCard quote={makeQuote()} />);

    expect(
      screen.queryByRole("button", { name: "אפשרויות נוספות" }),
    ).not.toBeInTheDocument();
    // The rest of the card is still fully readable.
    expect(screen.getByText("תמיד יש זמן לעוד קפה אחד")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /העתקה/ })).toBeInTheDocument();
  });
});
