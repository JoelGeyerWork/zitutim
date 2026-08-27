import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/components/session-provider";
import { ShotefReviews } from "@/components/shotef-reviews";
import type { ShotefReview, ShotefReviewList } from "@/lib/shotef-schema";
import type { Member } from "@/lib/team";
import { jsonResponse, makeSessionUser } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/shotef/reviews",
}));

const ROSTER: Member[] = [
  { id: "6b0000000000000000000011", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: "6b0000000000000000000012", name: "יונתן כץ", role: "שרת", gender: "m" },
];

/** A Thursday: the week that opened on the 23rd is still running. */
const NOW = "2026-08-27T09:00:00.000Z";

/**
 * The one existing summary is by someone **not** in `ROSTER` — a member since
 * removed from the on-call rotation. Their name has to survive that, which is
 * the whole point of resolving it from `users` rather than from the roster.
 */
const DEPARTED = "אורי בן־חיים";

const EXISTING: ShotefReview = {
  id: "w-1",
  weekStart: "2026-08-16T00:00:00.000Z",
  memberId: "6b00000000000000000000ff",
  memberName: DEPARTED,
  rating: 4,
  headline: "שבוע של תור ריק",
  body: "שתי פניות בלבד, ושתיהן נסגרו לפני הצהריים.",
};

const INITIAL: ShotefReviewList = {
  reviews: [EXISTING],
  total: 1,
  average: 4,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

/** Signed in unless told otherwise — the add button is gated on a session. */
function open(user: ReturnType<typeof makeSessionUser> | null = makeSessionUser()) {
  const actor = userEvent.setup();
  render(
    <SessionProvider user={user}>
      <ShotefReviews initial={INITIAL} roster={ROSTER} nowIso={NOW} />
    </SessionProvider>,
  );
  return actor;
}

/** Fill the two free-text fields; the week and the shotef default themselves. */
async function fill(dialog: HTMLElement, actor: ReturnType<typeof userEvent.setup>) {
  await actor.type(within(dialog).getByLabelText(/כותרת/), "שבוע רגוע");
  await actor.type(
    within(dialog).getByLabelText(/מה קרה/),
    "כלום לא נפל, וסגרנו שני באגים ישנים.",
  );
}

describe("ShotefReviews", () => {
  it("keeps the name on a summary by someone off the rotation", () => {
    open();

    // Resolved from `users` on read, so leaving the rotation does not erase
    // whoever wrote up a week that already happened.
    expect(screen.getByText(DEPARTED)).toBeInTheDocument();
  });

  // Deliberately drawn signed out too. The POST answers 401 and the dialog
  // sends them to login — which is the only way a signed-out reader discovers
  // that summarising a week exists. Hiding it left a populated page with no way
  // in at all, and the 401 is the enforcement either way.
  it("offers the add button to a signed-out reader as well", () => {
    open(null);

    expect(
      screen.getByRole("button", { name: /סיכום חדש/ }),
    ).toBeInTheDocument();
    // The summaries themselves stay public, like every other read here.
    expect(screen.getByText("שבוע של תור ריק")).toBeInTheDocument();
  });

  it("posts a summary and shows it without leaving the page", async () => {
    const saved: ShotefReview = {
      id: "w-2",
      weekStart: "2026-08-09T00:00:00.000Z",
      memberId: ROSTER[0].id,
      memberName: ROSTER[0].name,
      rating: 5,
      headline: "שבוע רגוע",
      body: "כלום לא נפל, וסגרנו שני באגים ישנים.",
    };
    fetchMock.mockImplementation(async () => jsonResponse(saved, 201));

    const actor = open();
    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    await fill(dialog, actor);
    await actor.click(within(dialog).getByRole("button", { name: "פרסום הסיכום" }));

    expect(await screen.findByText("שבוע רגוע")).toBeInTheDocument();
    // The totals move with the card — a new summary above an unchanged count
    // reads as a bug.
    expect(screen.getByText("2 שבועות מסוכמים")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/shotef/reviews");
    expect(init.method).toBe("POST");
    // The server page is re-run behind the optimistic card.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reports a week someone else summarised first", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "כבר יש סיכום לשבוע הזה" }, 409),
    );

    const actor = open();
    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    await fill(dialog, actor);
    await actor.click(within(dialog).getByRole("button", { name: "פרסום הסיכום" }));

    // Still open, carrying the reason, and nothing was added to the list.
    expect(
      await within(dialog).findByText("כבר יש סיכום לשבוע הזה"),
    ).toBeInTheDocument();
    expect(screen.getByText("שבוע אחד מסוכם")).toBeInTheDocument();
    // Refreshed anyway, so the week drops out of the picker.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("sends a lapsed session to the login page", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "פג תוקף החיבור" }, 401),
    );

    const actor = open();
    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    await fill(dialog, actor);
    await actor.click(within(dialog).getByRole("button", { name: "פרסום הסיכום" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/login?next=%2Fshotef%2Freviews"),
    );
  });

  // The picker only offers weeks that have closed and are not already written
  // up, so the default is the newest week still missing a summary — here the
  // one before the reviewed 16th, since the 23rd is still running.
  it("opens on the newest week that still needs one", async () => {
    const actor = open();

    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/איזה שבוע/)).toHaveTextContent(
      "9–15 באוגוסט",
    );
  });

  it("refuses a summary with nothing written in it", async () => {
    const actor = open();

    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    await actor.click(within(dialog).getByRole("button", { name: "פרסום הסיכום" }));

    expect(
      within(dialog).getByText("צריך משפט אחד שמסכם את השבוע"),
    ).toBeInTheDocument();
    expect(screen.getByText("שבוע אחד מסוכם")).toBeInTheDocument();
    // Caught before the round trip: the form's own check is for responsiveness.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Zero is a real score, and the only way to reach it is pressing the star
  // that already is the score — here the first one, twice: five to one, then
  // one to none.
  it("gives a week no stars at all", async () => {
    const actor = open();

    await actor.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    const first = within(dialog).getByRole("button", { name: "1 מתוך 5" });

    await actor.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");

    await actor.click(first);
    for (const star of within(dialog).getAllByRole("button", {
      name: /מתוך 5/,
    })) {
      expect(star).toHaveAttribute("aria-pressed", "false");
    }
  });
});
