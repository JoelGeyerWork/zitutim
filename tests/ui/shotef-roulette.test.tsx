import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "@/components/session-provider";
import { ShotefRoulette } from "@/components/shotef-roulette";
import { type RosterMember } from "@/lib/roster";
import { jsonResponse, makeSessionUser } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/shotef",
}));

/** A Wednesday: the shift that opened on Sunday the 23rd is still running. */
const NOW = "2026-08-26T09:00:00.000Z";

/**
 * Deliberately not the seed's names — the point of the whole
 * change is that these come off the `rotation` collection, so a test that used
 * the fixture would pass just as well if the wiring were reverted.
 */
const ROSTER: RosterMember[] = [
  {
    id: "6b0000000000000000000001",
    name: "רותם אבידן",
    role: "תשתיות",
    gender: "f",
    directoryId: "guid-rotem",
  },
  {
    id: "6b0000000000000000000002",
    name: "גלעד פרץ",
    role: "שרת",
    gender: "m",
    directoryId: "guid-gilad",
  },
  {
    id: "6b0000000000000000000003",
    name: "הילה נאור",
    role: "בדיקות",
    gender: "f",
    directoryId: "guid-hila",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

function renderWheel(
  roster: RosterMember[],
  { signedIn = true }: { signedIn?: boolean } = {},
) {
  const user = userEvent.setup();
  render(
    <SessionProvider user={signedIn ? makeSessionUser() : null}>
      <ShotefRoulette initialRoster={roster} nowIso={NOW} />
    </SessionProvider>,
  );
  return user;
}

describe("ShotefRoulette", () => {
  it("draws the wheel from the rotation it is handed", () => {
    renderWheel(ROSTER);

    // One full lap, so every stored member has a week on screen.
    for (const member of ROSTER) {
      expect(screen.getAllByText(member.name).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("עדיין אין אף אחד בתורנות.")).not.toBeInTheDocument();
  });

  it("says so instead of crashing when nobody is in the rotation", () => {
    // An unseeded database is a legitimate state: `buildShifts` returns [], and
    // the card used to dereference `shifts[0].member` straight through it.
    renderWheel([]);

    expect(screen.getByText("עדיין אין אף אחד בתורנות.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "הוספת אנשים לתורנות" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "סובבו את הגלגל" }),
    ).not.toBeInTheDocument();
  });

  // The empty state is what a fresh database shows everyone, so the way out of
  // it cannot be gated: the editor's own calls answer 401 and send them to
  // login. A separate login link here would be a second door to the same place.
  it("offers the empty state's add button to a signed-out visitor", () => {
    renderWheel([], { signedIn: false });

    expect(
      screen.getByRole("button", { name: "הוספת אנשים לתורנות" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /כניסה/ })).toBeNull();
  });

  // Drawn for everyone, like the meetup pencil beside it — the 401 behind it is
  // the enforcement, and this is the only affordance saying the roster is
  // editable at all.
  it("draws the pencil for a signed-out visitor too", () => {
    renderWheel(ROSTER, { signedIn: false });

    expect(screen.getByRole("button", { name: "סובבו את הגלגל" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "עריכת התורנות" }),
    ).toBeInTheDocument();
  });

  it("opens the on-call roster behind the pencil, in its own words", async () => {
    const user = renderWheel(ROSTER);

    await user.click(screen.getByRole("button", { name: "עריכת התורנות" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("התורנות")).toBeInTheDocument();
    // The verb the gender choice conjugates is this rotation's, not the ישב״צ's.
    expect(within(dialog).getAllByRole("radio", { name: "שוטפת" }).length).toBe(
      ROSTER.length,
    );
    expect(within(dialog).queryByText(/כיבוד/)).not.toBeInTheDocument();
  });

  it("writes a reorder to /api/shotef/rotation/order, not the ישב״צ's", async () => {
    // The keyboard nudge shares the drag's onReorder path and works in jsdom,
    // where a pointer drag (which measures row heights) cannot.
    const user = renderWheel(ROSTER);

    await user.click(screen.getByRole("button", { name: "עריכת התורנות" }));
    const dialog = await screen.findByRole("dialog");

    const firstRow = within(dialog).getByText("רותם אבידן").closest("li")!;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/shotef/rotation/order",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      ([url]) => url === "/api/shotef/rotation/order",
    )!;
    // 33 whole weeks from the anchor to this shift, over three people, puts the
    // stored head on duty — so offset 0 and the stored order is what is shown.
    expect(JSON.parse(call[1].body).ids).toEqual([
      ROSTER[1].id,
      ROSTER[0].id,
      ROSTER[2].id,
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it("removes through the on-call routes", async () => {
    const user = renderWheel(ROSTER);

    await user.click(screen.getByRole("button", { name: "עריכת התורנות" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: "פעולות על רותם אבידן" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "הוצאה מהתורנות" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/shotef/rotation/${ROSTER[0].id}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
