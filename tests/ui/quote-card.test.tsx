import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

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

  it("offers a download of the printable document", async () => {
    const user = userEvent.setup();
    render(<QuoteCard quote={makeQuote({ id: "abc123" })} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));

    const link = await screen.findByRole("menuitem", {
      name: "הורדה",
    });
    expect(link).toHaveAttribute("href", "/api/quotes/abc123/document");
    // Without `download` the browser would navigate to the HTML instead of
    // saving it, whatever Content-Disposition says.
    expect(link).toHaveAttribute("download");
  });

  it("opens the actions menu for signed-out visitors too", async () => {
    const user = userEvent.setup();
    render(<QuoteCard quote={makeQuote()} />);

    // Copying and downloading need no session, so the trigger cannot be gated
    // on one — everything reachable without a session stays reachable.
    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));

    expect(
      await screen.findByRole("menuitem", { name: "הורדה" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "העתקה" })).toBeInTheDocument();
    // The writes stay out of it.
    expect(
      screen.queryByRole("menuitem", { name: /עריכה/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /מחיקה/ }),
    ).not.toBeInTheDocument();
  });

  it("renders the context only when there is one", () => {
    const { rerender } = render(<QuoteCard quote={makeQuote()} />);
    expect(screen.queryByText("לפני הריטרו")).not.toBeInTheDocument();

    rerender(<QuoteCard quote={makeQuote({ context: "לפני הריטרו" })} />);
    expect(screen.getByText("לפני הריטרו")).toBeInTheDocument();
  });

  it("credits whoever added it, when known", () => {
    render(<QuoteCard quote={makeQuote({ addedBy: "יואל" })} />);

    const credit = screen.getByText("נוסף על ידי יואל");
    const saidAt = screen.getByText(/28 ביולי 2026/);
    expect(credit.closest("p")).toBe(saidAt.closest("p"));
    expect(
      credit.closest("article")?.querySelector("footer"),
    ).not.toBeInTheDocument();
  });

  it("puts one trigger in the header rather than a row of buttons", () => {
    renderSignedIn(<QuoteCard quote={makeQuote()} />);

    const trigger = screen.getByRole("button", { name: "אפשרויות נוספות" });
    const header = trigger.closest("header");

    expect(header).toBeInTheDocument();
    // The card should read as a quote, not a toolbar: the trigger is the only
    // control in the header, and everything else lives behind it.
    expect(within(header!).getAllByRole("button")).toEqual([trigger]);
    expect(within(header!).queryAllByRole("link")).toHaveLength(0);
  });

  it("copies the quote and attribution to the clipboard", async () => {
    // setup() installs its own clipboard stub, so spy on it afterwards.
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(<QuoteCard quote={makeQuote()} />);
    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));
    await user.click(await screen.findByRole("menuitem", { name: "העתקה" }));

    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("תמיד יש זמן לעוד קפה אחד");
    expect(copied).toContain("דנה");
    expect(copied).toContain("28 ביולי 2026");

    // The menu closes on click, so a checkmark on the item would never be seen.
    // The toast is the whole of the feedback.
    expect(toast.success).toHaveBeenCalledWith("הציטוט הועתק");
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
      <QuoteCard
        quote={makeQuote({ text: "Ship it, then ship it again" })}
        highlight="ship"
      />,
    );
    expect(
      screen.getAllByText(/ship/i).filter((el) => el.tagName === "MARK"),
    ).toHaveLength(2);
  });

  it("treats a regex metacharacter in the term as literal text", () => {
    render(
      <QuoteCard quote={makeQuote({ text: "אמר .* בכוונה" })} highlight=".*" />,
    );

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

  it("asks for confirmation before mailing the team", async () => {
    const user = userEvent.setup();
    renderSignedIn(<QuoteCard quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));
    await user.click(await screen.findByRole("menuitem", { name: "שליחה" }));

    // One stray click would reach every colleague's inbox, so the dialog names
    // what is about to happen rather than sending on the first click.
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("לשלוח את הציטוט לצוות?"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/רשימת התפוצה/)).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in rather than hiding the action", async () => {
    const user = userEvent.setup();
    render(<QuoteCard quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));

    // The same shape as the like button: the action stays present and becomes a
    // route to sign-in, instead of disappearing for anyone without a session.
    const link = await screen.findByRole("menuitem", {
      name: "התחברות כדי לשלוח",
    });
    expect(link).toHaveAttribute("href", "/login?next=%2Fquotes");

    expect(
      screen.queryByRole("menuitem", { name: "שליחה" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the editing actions out of the menu when signed out", async () => {
    // Presentation only — the API's 401 is what actually stops the edit.
    const user = userEvent.setup();
    render(<QuoteCard quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "אפשרויות נוספות" }));
    await screen.findByRole("menuitem", { name: "העתקה" });

    expect(
      screen.queryByRole("menuitem", { name: /עריכה/ }),
    ).not.toBeInTheDocument();
    // The rest of the card is still fully readable.
    expect(screen.getByText("תמיד יש זמן לעוד קפה אחד")).toBeInTheDocument();
  });
});
