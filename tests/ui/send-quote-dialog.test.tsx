import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SendQuoteDialog } from "@/components/send-quote-dialog";
import { makeQuote, respondWith } from "./factories";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <SendQuoteDialog quote={makeQuote()} open onOpenChange={onOpenChange} />,
  );
  return onOpenChange;
}

function sendButton() {
  return screen.getByRole("button", { name: "שליחה" });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  // Restoring fetch by hand rather than with vi.unstubAllGlobals(): that also
  // tears down the localStorage substitute tests/setup/dom.ts installs, and the
  // next file's beforeEach then dies on localStorage.clear().
  globalThis.fetch = realFetch;
});

describe("SendQuoteDialog", () => {
  it("posts to the send route and reports success", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation(
      respondWith({ sent: true, to: "team@test.local", dryRun: false }),
    );

    const onOpenChange = renderDialog();
    await user.click(sendButton());

    expect(fetch).toHaveBeenCalledWith(
      `/api/quotes/${makeQuote().id}/send`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(toast.success).toHaveBeenCalledWith("הציטוט נשלח לצוות");
    // Closes on success, so the card is visible again underneath.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says so when the server only pretended to send", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation(
      respondWith({ sent: false, to: "team@test.local", dryRun: true }),
    );

    renderDialog();
    await user.click(sendButton());

    // MAIL_DRY_RUN is exactly the setting someone forgets is on. Reporting
    // "sent" here would be a lie the sender has no way to notice.
    expect(toast.success).toHaveBeenCalledWith(
      "מצב הרצה יבשה — המייל נבנה אבל לא נשלח",
    );
  });

  it("surfaces the server's own message and stays open on failure", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockImplementation(
      respondWith({ error: "שליחת המייל לא מוגדרת בשרת" }, 500),
    );

    const onOpenChange = renderDialog();
    await user.click(sendButton());

    expect(toast.error).toHaveBeenCalledWith("שליחת המייל לא מוגדרת בשרת");
    expect(toast.success).not.toHaveBeenCalled();
    // Left open so the sender can retry rather than losing the action.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("reports a dead connection distinctly from a refusal", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    renderDialog();
    await user.click(sendButton());

    expect(toast.error).toHaveBeenCalledWith("אין חיבור לשרת");
  });

  it("cannot be sent twice by double-clicking", async () => {
    const user = userEvent.setup();
    let release: (value: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    renderDialog();
    await user.click(sendButton());

    // Disabled while in flight: there is no unsending the first one.
    expect(sendButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeDisabled();

    await user.click(sendButton());
    expect(fetch).toHaveBeenCalledTimes(1);

    release(new Response(JSON.stringify({ sent: true }), { status: 200 }));
  });
});
