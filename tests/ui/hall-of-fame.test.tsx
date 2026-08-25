import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HallOfFame } from "@/components/shotef-hall-of-fame";
import type { SolvedMonitor } from "@/lib/shotef";
import type { Member } from "@/lib/team";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const ROSTER: Member[] = [
  { id: "maya", name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: "yonatan", name: "יונתן כץ", role: "שרת", gender: "m" },
];

const WALL: SolvedMonitor[] = [
  {
    id: "m-1",
    icon: "memory",
    monitor: "db-prod-01: RAM above 95%",
    solution: "אינדקס שהיה חסר, ומאז הזיכרון יציב.",
    solvedByIds: ["maya"],
    firstFiredAt: "2026-06-09T00:00:00.000Z",
    solvedAt: "2026-08-18T00:00:00.000Z",
    minutesToFix: 180,
  },
];

/** Fill in every required field of the add form with something valid. */
async function fillForm(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    within(dialog).getByLabelText(/שם המוניטור/),
    "redis-02: evicted keys above 1k/min",
  );
  await user.type(
    within(dialog).getByLabelText(/איך פתרנו/),
    "הכפלנו את מגבלת הזיכרון והוצאנו את המפתחות הגדולים.",
  );
  await user.click(within(dialog).getByRole("button", { name: "יונתן כץ" }));
  // A date input takes a whole value at once; typing it a character at a time
  // walks through the segments instead.
  fireEvent.change(within(dialog).getByLabelText(/מתי התחיל לצעוק/), {
    target: { value: "2026-07-01" },
  });
  fireEvent.change(within(dialog).getByLabelText(/מתי הושתק/), {
    target: { value: "2026-08-20" },
  });
  await user.type(within(dialog).getByLabelText(/כמה זמן לקח לתקן/), "4");
}

describe("HallOfFame", () => {
  it("hangs a new certificate on the wall without leaving the page", async () => {
    const user = userEvent.setup();
    render(<HallOfFame initial={WALL} roster={ROSTER} />);

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await screen.findByRole("dialog");
    await fillForm(dialog, user);
    await user.click(within(dialog).getByRole("button", { name: "תליית התעודה" }));

    expect(
      await screen.findByText("redis-02: evicted keys above 1k/min"),
    ).toBeInTheDocument();
    // Newest first, so the new one leads the wall.
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "redis-02: evicted keys above 1k/min",
    );
  });

  it("counts the new certificate for everyone named on it", async () => {
    const user = userEvent.setup();
    render(<HallOfFame initial={WALL} roster={ROSTER} />);

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await screen.findByRole("dialog");
    await fillForm(dialog, user);
    // A second name, to prove two picks in one form both survive.
    await user.click(within(dialog).getByRole("button", { name: "מאיה גלעד" }));
    await user.click(within(dialog).getByRole("button", { name: "תליית התעודה" }));

    await screen.findByText("redis-02: evicted keys above 1k/min");

    // Scoped to the podium: the trophy case counts the wall in the same words.
    const podium = within(
      screen.getByText("מי השתיק הכי הרבה").closest("section") as HTMLElement,
    );
    // מאיה is on both plaques now; יונתן is on the one he was just added to.
    expect(podium.getByText("מאיה גלעד")).toBeInTheDocument();
    expect(podium.getByText("2 הישגים")).toBeInTheDocument();
    expect(podium.getByText("יונתן כץ")).toBeInTheDocument();
    expect(podium.getByText("הישג אחד")).toBeInTheDocument();
  });

  it("refuses a certificate with nobody on it", async () => {
    const user = userEvent.setup();
    render(<HallOfFame initial={WALL} roster={ROSTER} />);

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/שם המוניטור/),
      "redis-02: evicted keys above 1k/min",
    );
    await user.click(within(dialog).getByRole("button", { name: "תליית התעודה" }));

    expect(
      within(dialog).getByText("צריך לבחור לפחות אדם אחד"),
    ).toBeInTheDocument();
    // Still open, and nothing was hung on the wall.
    expect(screen.queryByText("redis-02: evicted keys above 1k/min")).toBeNull();
  });
});
