import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditQuoteDialog } from "@/components/edit-quote-dialog";
import { SessionProvider } from "@/components/session-provider";
import { jsonResponse, makeQuote, makeSessionUser } from "./factories";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/quotes",
}));

/** `GET /api/rotation`'s public shape — names and `users._id`, no objectGUID. */
const ROTATION = {
  members: [
    { userId: "6b0000000000000000000011", name: "מאיה גלעד", title: "עיצוב מוצר", gender: "f" },
    { userId: "6b0000000000000000000012", name: "יונתן כץ", title: "שרת", gender: "m" },
  ],
};

/** A quote that already points at a `users` row, as one added by the picker does. */
const QUOTE = makeQuote({
  author: "מאיה גלעד",
  authorId: ROTATION.members[0].userId,
});

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/rotation")) return jsonResponse(ROTATION);
    if (String(url).startsWith("/api/directory")) throw new Error("no DC");
    return jsonResponse(QUOTE);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  // Restoring fetch by hand rather than with vi.unstubAllGlobals() — see
  // send-quote-dialog.test.tsx for why that one takes localStorage with it.
  globalThis.fetch = realFetch;
});

function renderDialog(open = true) {
  const user = userEvent.setup();
  render(
    <SessionProvider user={makeSessionUser()}>
      <EditQuoteDialog quote={QUOTE} open={open} onOpenChange={vi.fn()} />
    </SessionProvider>,
  );
  return user;
}

describe("EditQuoteDialog", () => {
  it("offers the rotation so the speaker can be changed, not only corrected", async () => {
    // Without this the only `{ source: "user" }` reference the form could send
    // is the quote's own `authorId`, and swapping to a colleague would need the
    // directory — the path that must keep working with no domain controller.
    // The fetch mock refuses `/api/directory` outright to prove it is not used.
    const user = renderDialog();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "יונתן כץ" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "יונתן כץ" }));
    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === `/api/quotes/${QUOTE.id}`),
      ).toBe(true),
    );
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => url === `/api/quotes/${QUOTE.id}`,
    )!;
    expect(JSON.parse(init.body as string).author).toEqual({
      source: "user",
      id: ROTATION.members[1].userId,
    });
  });

  it("reads the rotation only once the dialog is open", () => {
    renderDialog(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still edits the quote when the rotation cannot be read", async () => {
    // The rotation is a shortcut, not the way in: the quote's own author is
    // already on the row, so a failed read costs the other names and nothing else.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("/api/rotation")
        ? jsonResponse({ error: "לא הצלחנו לטעון את הסבב" }, 500)
        : jsonResponse(QUOTE),
    );

    const user = renderDialog();
    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === `/api/quotes/${QUOTE.id}`),
      ).toBe(true),
    );
  });
});
