import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEETUP_COPY, RotationEditor } from "@/components/rotation-editor";
import { SessionProvider } from "@/components/session-provider";
import { type RosterMember } from "@/lib/roster";
import { type MeetupSlot } from "@/lib/team";
import { jsonResponse, makeSessionUser } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/meetups",
}));

function member(
  id: string,
  name: string,
  directoryId = `dir-${id}`,
): RosterMember {
  return { id, name, role: "מפתחת", gender: "f", directoryId };
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const FIRST = Date.UTC(2026, 7, 18);

function slotsFor(queue: RosterMember[]): MeetupSlot[] {
  return queue.map((entry, index) => ({
    date: new Date(FIRST + index * WEEK).toISOString(),
    weeksAway: index,
    member: entry,
  }));
}

/**
 * Signed in, because `DirectorySearch` offers the box only to a session —
 * `GET /api/directory` is the one read here that refuses to answer anonymously,
 * so a search field that could only ever 401 is worse than saying so.
 */
function editor(queue: RosterMember[], offset = 0, user = makeSessionUser()) {
  return (
    <SessionProvider user={user}>
      <RotationEditor
        open
        onOpenChange={() => {}}
        roster={queue}
        slots={slotsFor(queue)}
        offset={offset}
        copy={MEETUP_COPY}
      />
    </SessionProvider>
  );
}

/** Route the mocked fetch by URL, a fresh Response every call. */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/directory")) {
      return jsonResponse({
        people: [
          {
            directoryId: "guid-shira",
            displayName: "שירה לוי",
            title: "לקוח",
            username: "shira.levi",
          },
        ],
      });
    }
    if (url === "/api/rotation/order") return jsonResponse({ ok: true });
    if (url === "/api/rotation") {
      return jsonResponse(
        { member: { userId: "m9", name: "שירה לוי", title: "לקוח", gender: "f" } },
        201,
      );
    }
    return jsonResponse({}, 200);
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("RotationEditor", () => {
  it("has no former-members section any more", async () => {
    render(editor([member("m1", "נועה ברקת"), member("m2", "איתי שרון")]));
    await screen.findByRole("dialog");

    expect(screen.queryByText(/לא בסבב/)).not.toBeInTheDocument();
    expect(screen.queryByText(/החזרה לסבב/)).not.toBeInTheDocument();
  });

  it("issues one PUT /api/rotation/order with the stored order on a keyboard reorder", async () => {
    // The keyboard nudge shares the drag's onReorder path, and works in jsdom
    // where a pointer drag (which measures row heights) cannot.
    const queue = [
      member("m1", "נועה ברקת"),
      member("m2", "איתי שרון"),
      member("m3", "שירה לוי"),
    ];
    render(editor(queue, 0));
    const dialog = await screen.findByRole("dialog");

    const firstRow = within(dialog).getByText("נועה ברקת").closest("li")!;
    firstRow.focus();
    fireEvent.keyDown(firstRow, { key: "ArrowDown" });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rotation/order",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/rotation/order");
    expect(calls).toHaveLength(1);
    // offset 0, so the stored order is the displayed order after the swap.
    expect(JSON.parse(calls[0][1].body).ids).toEqual(["m2", "m1", "m3"]);
  });

  it("posts { directoryId, gender } when a directory pick is confirmed", async () => {
    const user = userEvent.setup();
    render(editor([member("m1", "נועה ברקת", "guid-noa")]));
    const dialog = await screen.findByRole("dialog");

    // Into the search view, then find someone in the directory.
    await user.click(within(dialog).getByRole("button", { name: "הוספה" }));
    await user.type(
      screen.getByLabelText("חיפוש בספריית הארגון"),
      "שירה",
    );

    // The single result's add button — the debounced directory search resolved.
    const result = await screen.findByText("שירה לוי");
    await user.click(
      within(result.closest("li")!).getByRole("button", { name: "הוספה" }),
    );

    // Confirm view: default gender is feminine; add to the rotation.
    await user.click(await screen.findByRole("button", { name: "הוספה לסבב" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/rotation",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(([url]) => url === "/api/rotation")!;
    expect(JSON.parse(call[1].body)).toEqual({
      directoryId: "guid-shira",
      gender: "f",
    });
  });

  it("offers a signed-out reader the login page instead of a box that cannot answer", async () => {
    const user = userEvent.setup();
    render(editor([member("m1", "נועה ברקת")], 0, null!));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "הוספה" }));

    expect(
      screen.queryByLabelText("חיפוש בספריית הארגון"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כניסה" })).toHaveAttribute(
      "href",
      "/login?next=%2Fmeetups",
    );
  });

  it("marks a directory result already in the rotation rather than offering to add", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/directory")) {
        return jsonResponse({
          people: [
            {
              directoryId: "guid-noa",
              displayName: "נועה ברקת",
              title: "ראשת צוות",
              username: "noa.bareket",
            },
          ],
        });
      }
      return jsonResponse({}, 200);
    });

    const user = userEvent.setup();
    render(editor([member("m1", "נועה ברקת", "guid-noa")]));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "הוספה" }));
    await user.type(screen.getByLabelText("חיפוש בספריית הארגון"), "נועה");

    // Already in the rotation — a badge, not an add button.
    expect(await screen.findByText("כבר בסבב")).toBeInTheDocument();
  });
});
