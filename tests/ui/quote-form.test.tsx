import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteForm } from "@/components/quote-form";
import { SessionProvider } from "@/components/session-provider";
import type { RosterMember } from "@/lib/roster";
import { jsonResponse, makeQuote, makeSessionUser } from "./factories";

// The factory must be self-contained — vi.mock is hoisted above the imports.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/quotes/create",
}));

/**
 * The team, as the create page hands it down — the picker's fast path. It keeps
 * `directoryId` there, which is what lets a search result be recognised as
 * somebody already on the row.
 */
const ROSTER: RosterMember[] = [
  { id: "6b0000000000000000000011", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f", directoryId: "guid-maya" },
  { id: "6b0000000000000000000012", name: "יונתן כץ", role: "שרת", gender: "m", directoryId: "guid-yonatan" },
];

const ROI = {
  directoryId: "guid-roi",
  displayName: "רועי אשכנזי",
  title: "אבטחת מידע",
  username: "roi.ashkenazi",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockClear();
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith("/api/directory")
      ? jsonResponse({ people: [ROI] })
      : jsonResponse(makeQuote(), 201),
  );
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * Signed in and holding the roster, which is how the create page renders it.
 * The session is what the directory search needs — `GET /api/directory` is the
 * one read here that refuses to answer anonymously.
 */
function renderForm(props: Partial<Parameters<typeof QuoteForm>[0]> = {}) {
  const user = userEvent.setup();
  render(
    <SessionProvider user={makeSessionUser()}>
      <QuoteForm roster={ROSTER} {...props} />
    </SessionProvider>,
  );
  return user;
}

/** Pick a name out of the "מי אמר?" row. */
async function pickAuthor(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole("button", { name, pressed: false }));
}

/** Whoever the row currently has picked, or undefined. */
function pickedAuthor(): string | undefined {
  return screen
    .queryAllByRole("button", { pressed: true })
    .map((button) => button.textContent ?? "")[0];
}

/** Fills the required fields; the date input defaults to today already. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
  await pickAuthor(user, "מאיה גלעד");
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("QuoteForm — creating", () => {
  it("defaults the date to today", () => {
    renderForm();
    const today = new Date();
    const expected = new Date(
      today.getTime() - today.getTimezoneOffset() * 60_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(screen.getByLabelText(/מתי/)).toHaveValue(expected);
  });

  it("POSTs the filled values to /api/quotes", async () => {
    const user = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init, body } = lastRequest();
    expect(url).toBe("/api/quotes");
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({
      text: "משהו שנאמר",
      // A reference, never a name the client typed — the server resolves it.
      author: { source: "user", id: ROSTER[0].id },
    });
  });

  it("blocks submission and names the missing fields in Hebrew", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText("צריך לכתוב מה נאמר")).toBeInTheDocument();
    expect(screen.getByText("צריך לציין מי אמר")).toBeInTheDocument();
  });

  it("clears a field's error as soon as it is edited", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));
    expect(await screen.findByText("צריך לציין מי אמר")).toBeInTheDocument();

    await pickAuthor(user, "יונתן כץ");
    expect(screen.queryByText("צריך לציין מי אמר")).not.toBeInTheDocument();
    expect(screen.getByText("צריך לכתוב מה נאמר")).toBeInTheDocument();
  });

  it("renders server-side field errors from a 422", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { error: "יש שדות לא תקינים", issues: { saidAt: "התאריך בעתיד" } },
        422,
      ),
    );

    const user = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    expect(await screen.findByText("התאריך בעתיד")).toBeInTheDocument();
  });

  it("resets the fields after a successful save", async () => {
    const user = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(screen.getByLabelText(/מה נאמר/)).toHaveValue(""),
    );
    expect(pickedAuthor()).toBeUndefined();
  });

  it("hands the saved quote to onSuccess", async () => {
    const onSuccess = vi.fn();
    const saved = makeQuote({ id: "6a000000000000000000000f" });
    fetchMock.mockImplementation(async () => jsonResponse(saved, 201));

    const user = renderForm({ onSuccess });
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
    fetchMock.mockImplementation(async () => jsonResponse({ error: "נפל" }, 500));

    const user = renderForm({ onSuccess });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("survives the network being down", async () => {
    const user = renderForm();
    await fillRequired(user);
    fetchMock.mockRejectedValue(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    // Still interactive, values intact, ready for a retry.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "הוספה לקיר" })).toBeEnabled(),
    );
    expect(screen.getByLabelText(/מה נאמר/)).toHaveValue("משהו שנאמר");
    expect(toast.error).toHaveBeenCalledWith("אין חיבור לשרת");
  });

  it("confirms the save with a toast", async () => {
    const user = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("הציטוט נוסף לקיר"),
    );
  });
});

describe("QuoteForm — who said it", () => {
  it("offers the team without asking the directory anything", () => {
    renderForm();

    for (const member of ROSTER) {
      expect(
        screen.getByRole("button", { name: member.name }),
      ).toBeInTheDocument();
    }
    // The fast path is the whole point: no network for a name already on hand.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names somebody found in the directory, by reference", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
    await user.click(
      screen.getByRole("button", { name: /חיפוש בספריית הארגון/ }),
    );
    await user.type(screen.getByLabelText(/חיפוש בספריית הארגון/), "רועי");

    await user.click(await screen.findByRole("button", { name: "בחירה" }));
    // The pick becomes the answer, and the search closes behind it. Base UI's
    // Select used to drop it here — it clears a controlled value that is not
    // among its registered items, which a freshly appended person never is.
    expect(pickedAuthor()).toBe(ROI.displayName);

    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));
    await waitFor(() =>
      expect(lastRequest().body.author).toEqual({
        source: "directory",
        id: ROI.directoryId,
      }),
    );
  });

  it("still takes a name typed by hand, for a speaker outside the organisation", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
    await user.click(screen.getByRole("button", { name: /כתיבת שם/ }));
    await user.type(screen.getByLabelText(/מי אמר/), "שירה מהלקוח");

    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));
    await waitFor(() =>
      expect(lastRequest().body.author).toEqual({
        source: "name",
        name: "שירה מהלקוח",
      }),
    );
  });

  it("keeps the pick through a re-render of the row", async () => {
    // The regression this row exists for: picking, then anything that changes
    // the list of names, must not quietly clear the answer.
    const user = renderForm();
    await pickAuthor(user, "מאיה גלעד");

    await user.click(
      screen.getByRole("button", { name: /חיפוש בספריית הארגון/ }),
    );
    await user.type(screen.getByLabelText(/חיפוש בספריית הארגון/), "רועי");
    await screen.findByRole("button", { name: "בחירה" });

    expect(pickedAuthor()).toBe("מאיה גלעד");
  });

  it("lights up the button a teammate already has, rather than a second one", async () => {
    // The same person is two *keys* — `user:<_id>` off the rotation and
    // `directory:<objectGUID>` off the search — and the server folds them
    // together only after resolving. Two identical names with one pressed is
    // the version of that the person filling the form has to look at.
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("/api/directory")
        ? jsonResponse({
            people: [
              {
                directoryId: ROSTER[0].directoryId,
                displayName: ROSTER[0].name,
                title: ROSTER[0].role,
                username: "maya.gilad",
              },
            ],
          })
        : jsonResponse(makeQuote(), 201),
    );

    const user = renderForm();
    await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
    await user.click(
      screen.getByRole("button", { name: /חיפוש בספריית הארגון/ }),
    );
    await user.type(screen.getByLabelText(/חיפוש בספריית הארגון/), "מאיה");
    await user.click(await screen.findByRole("button", { name: "בחירה" }));

    expect(screen.getAllByRole("button", { name: ROSTER[0].name })).toHaveLength(1);
    expect(pickedAuthor()).toBe(ROSTER[0].name);

    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));
    await waitFor(() =>
      // The reference that needs no directory is the better of the two to send.
      expect(lastRequest().body.author).toEqual({
        source: "user",
        id: ROSTER[0].id,
      }),
    );
  });

  it("keeps the typed-name way out reachable while the search is open", async () => {
    // An empty rotation opens straight onto the search, and the typed name is
    // the arm that survives the directory being down — so it must not sit
    // behind the panel that is reporting the outage.
    const user = renderForm({ roster: [] });
    expect(screen.getByLabelText("חיפוש בספריית הארגון")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /כתיבת שם/ }));
    await user.type(screen.getByLabelText(/מי אמר/), "שירה מהלקוח");
    await user.type(screen.getByLabelText(/מה נאמר/), "משהו שנאמר");
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(lastRequest().body.author).toEqual({
        source: "name",
        name: "שירה מהלקוח",
      }),
    );
  });

  it("carries a picked name over when switching to typing it", async () => {
    const user = renderForm();
    await pickAuthor(user, "מאיה גלעד");
    await user.click(screen.getByRole("button", { name: /כתיבת שם/ }));

    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("מאיה גלעד");
  });

  it("opens on the search when there is nobody to offer", async () => {
    // An unseeded rotation: hiding the search behind a link would leave an
    // empty select as the entire field.
    renderForm({ roster: [] });
    expect(
      screen.getByLabelText("חיפוש בספריית הארגון"),
    ).toBeInTheDocument();
  });

  it("sends a signed-out reader to log in rather than searching", () => {
    // The search is the one control here that is gated on the session, because
    // `GET /api/directory` would 401 on every keystroke.
    render(
      <SessionProvider user={null}>
        <QuoteForm roster={[]} />
      </SessionProvider>,
    );

    expect(screen.queryByLabelText("חיפוש בספריית הארגון")).toBeNull();
    expect(screen.getByRole("link", { name: "כניסה" })).toHaveAttribute(
      "href",
      "/login?next=%2Fquotes%2Fcreate",
    );
  });
});

describe("QuoteForm — attribution", () => {
  it("never sends addedBy: the server takes it from the session", async () => {
    const user = renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastRequest().body).not.toHaveProperty("addedBy");
  });

  it("has no submitter field to fill in", () => {
    renderForm();
    expect(screen.queryByLabelText(/מי מוסיף/)).not.toBeInTheDocument();
  });

  it("sends the user to login when the session has lapsed", async () => {
    const user = renderForm();
    await fillRequired(user);
    // Sitting on the form for eight hours and then saving must not just say
    // "failed" — there is something the user can do about it.
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "צריך להתחבר כדי לשנות משהו כאן" }, 401),
    );
    await user.click(screen.getByRole("button", { name: "הוספה לקיר" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(expect.stringContaining("/login?next=")),
    );
    expect(toast.error).toHaveBeenCalledWith("צריך להתחבר כדי לשנות משהו כאן");
  });
});

describe("QuoteForm — editing", () => {
  const quote = makeQuote({ context: "לפני הריטרו", addedBy: "יואל" });
  /** The same quote, said by somebody the app holds a row for. */
  const picked = makeQuote({
    author: "מאיה גלעד",
    authorId: ROSTER[0].id,
    context: "לפני הריטרו",
  });

  /** The edit dialog passes no roster: the quote's own author is the answer. */
  function renderEdit(subject = quote, props = {}) {
    const user = userEvent.setup();
    render(
      <SessionProvider user={makeSessionUser()}>
        <QuoteForm quote={subject} {...props} />
      </SessionProvider>,
    );
    return user;
  }

  it("pre-fills every field from the quote", () => {
    renderEdit();

    expect(screen.getByLabelText(/מה נאמר/)).toHaveValue(quote.text);
    // No `authorId` on this one, so the stored name is what is being edited.
    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("דנה");
    expect(screen.getByLabelText(/מתי/)).toHaveValue("2026-07-28");
    expect(screen.getByLabelText(/הקשר/)).toHaveValue("לפני הריטרו");
  });

  it("starts on the person a quote already points at", () => {
    renderEdit(picked);
    expect(pickedAuthor()).toBe("מאיה גלעד");
  });

  it("retargets the speaker to another teammate without the directory", async () => {
    // The gap the roster closes here: with only the quote's own author on
    // offer, "it was actually the person next to them" would need `GET
    // /api/directory` — the one path that is supposed to work with no domain
    // controller on the network.
    const user = renderEdit(picked, { roster: ROSTER });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/directory")) throw new Error("no DC");
      return jsonResponse(picked);
    });

    await pickAuthor(user, "יונתן כץ");
    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(lastRequest().body.author).toEqual({
      source: "user",
      id: ROSTER[1].id,
    });
  });

  it("PUTs to the quote's own endpoint", async () => {
    const user = renderEdit();
    fetchMock.mockImplementation(async () => jsonResponse(quote));

    await user.clear(screen.getByLabelText(/מה נאמר/));
    await user.type(screen.getByLabelText(/מה נאמר/), "ניסוח מתוקן");
    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const { url, init, body } = lastRequest();
    expect(url).toBe(`/api/quotes/${quote.id}`);
    expect(init.method).toBe("PUT");
    expect(body.text).toBe("ניסוח מתוקן");
    // A quote with no id keeps its name as a name: it may be somebody the
    // directory cannot answer for, and a typo fix must not demand otherwise.
    expect(body.author).toEqual({ source: "name", name: "דנה" });
  });

  it("keeps the edited values on screen after saving", async () => {
    const user = renderEdit();
    fetchMock.mockImplementation(async () => jsonResponse(quote));

    await user.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/מי אמר/)).toHaveValue("דנה");
  });

  it("shows a cancel button only when a handler is given", async () => {
    const onCancel = vi.fn();
    const user = renderEdit();
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();

    render(
      <SessionProvider user={makeSessionUser()}>
        <QuoteForm quote={quote} onCancel={onCancel} />
      </SessionProvider>,
    );
    await user.click(screen.getAllByRole("button", { name: "ביטול" })[0]);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
