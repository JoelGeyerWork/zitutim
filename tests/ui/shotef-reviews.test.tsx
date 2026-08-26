import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShotefReviews } from "@/components/shotef-reviews";
import type { ShotefReview } from "@/lib/shotef";
import type { Member } from "@/lib/team";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const ROSTER: Member[] = [
  { id: "maya", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: "yonatan", name: "יונתן כץ", role: "שרת", gender: "m" },
];

/** A Thursday: the week that opened on the 23rd is still running. */
const NOW = "2026-08-27T09:00:00.000Z";

const REVIEWS: ShotefReview[] = [
  {
    id: "w-1",
    weekStart: "2026-08-16T00:00:00.000Z",
    memberId: "maya",
    rating: 4,
    headline: "שבוע של תור ריק",
    body: "שתי פניות בלבד, ושתיהן נסגרו לפני הצהריים.",
  },
];

function open() {
  const user = userEvent.setup();
  render(<ShotefReviews initial={REVIEWS} roster={ROSTER} nowIso={NOW} />);
  return user;
}

describe("ShotefReviews", () => {
  it("adds a summary without leaving the page", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText(/כותרת/), "שבוע רגוע");
    await user.type(
      within(dialog).getByLabelText(/מה קרה/),
      "כלום לא נפל, וסגרנו שני באגים ישנים.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "פרסום הסיכום" }),
    );

    expect(await screen.findByText("שבוע רגוע")).toBeInTheDocument();
    expect(screen.getByText("2 שבועות מסוכמים")).toBeInTheDocument();
  });

  // The picker only offers weeks that have closed and are not already written
  // up, so the default is the newest week still missing a summary — here the
  // one before the reviewed 16th, since the 23rd is still running.
  it("opens on the newest week that still needs one", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/איזה שבוע/)).toHaveTextContent(
      "9–15 באוגוסט",
    );
  });

  it("refuses a summary with nothing written in it", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "פרסום הסיכום" }),
    );

    expect(
      within(dialog).getByText("צריך משפט אחד שמסכם את השבוע"),
    ).toBeInTheDocument();
    expect(screen.getByText("שבוע אחד מסוכם")).toBeInTheDocument();
  });

  // Zero is a real score, and the only way to reach it is pressing the star
  // that already is the score — here the first one, twice: five to one, then
  // one to none.
  it("gives a week no stars at all", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /סיכום חדש/ }));
    const dialog = await screen.findByRole("dialog");
    const first = within(dialog).getByRole("button", { name: "1 מתוך 5" });

    await user.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");

    await user.click(first);
    for (const star of within(dialog).getAllByRole("button", {
      name: /מתוך 5/,
    })) {
      expect(star).toHaveAttribute("aria-pressed", "false");
    }
  });
});
