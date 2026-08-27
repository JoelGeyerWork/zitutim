import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HallOfFame } from "@/components/shotef-hall-of-fame";
import { SessionProvider } from "@/components/session-provider";
import type { MonitorWall, SolvedMonitor, Solver } from "@/lib/shotef-schema";
import type { Member } from "@/lib/team";
import { makeSessionUser, respondWith } from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/shotef/hall-of-fame",
}));

/** `users._id` hex strings — what the picker sends and the route resolves. */
const MAYA = "6b0000000000000000000011";
const YONATAN = "6b0000000000000000000012";
/** Never on the rotation, so only a plaque can name them. */
const RONIT = "6b0000000000000000000013";

const ROSTER: Member[] = [
  { id: MAYA, name: "מאיה גלעד", role: "עיצוב מוצר", gender: "f" },
  { id: YONATAN, name: "יונתן כץ", role: "שרת", gender: "m" },
];

const PLAQUE: SolvedMonitor = {
  id: "6c0000000000000000000001",
  icon: "memory",
  monitor: "db-prod-01: RAM above 95%",
  solution: "אינדקס שהיה חסר, ומאז הזיכרון יציב.",
  solvedBy: [{ id: MAYA, name: "מאיה גלעד" }],
  firstFiredAt: "2026-06-09T00:00:00.000Z",
  solvedAt: "2026-08-18T00:00:00.000Z",
  minutesToFix: 180,
};

/** What the server hands back for the certificate the tests fill in below. */
const CREATED: SolvedMonitor = {
  id: "6c0000000000000000000002",
  icon: "memory",
  monitor: "redis-02: evicted keys above 1k/min",
  solution: "הכפלנו את מגבלת הזיכרון והוצאנו את המפתחות הגדולים.",
  solvedBy: [{ id: YONATAN, name: "יונתן כץ" }],
  firstFiredAt: "2026-07-01T00:00:00.000Z",
  solvedAt: "2026-08-20T00:00:00.000Z",
  minutesToFix: 240,
};

const BOARD: Solver[] = [
  { member: ROSTER[0], solved: 1, lastSolved: "2026-08-18T00:00:00.000Z" },
];

function wall(overrides: Partial<MonitorWall> = {}): MonitorWall {
  return {
    monitors: [PLAQUE],
    board: BOARD,
    fastest: PLAQUE,
    solverCount: 1,
    ...overrides,
  };
}

function open(
  initial: MonitorWall = wall(),
  user = makeSessionUser() as ReturnType<typeof makeSessionUser> | null,
) {
  const actor = userEvent.setup();
  render(
    <SessionProvider user={user}>
      <HallOfFame initial={initial} roster={ROSTER} />
    </SessionProvider>,
  );
  return actor;
}

/** Fill in every required field of the add form with something valid. */
async function fillForm(
  dialog: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
) {
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

async function submit(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog");
  await fillForm(dialog, user);
  await user.click(within(dialog).getByRole("button", { name: "תליית התעודה" }));
  return dialog;
}

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(respondWith(CREATED, 201)));
});

describe("HallOfFame", () => {
  it("posts the new certificate and hangs the saved record", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    await submit(user);

    expect(
      await screen.findByText("redis-02: evicted keys above 1k/min"),
    ).toBeInTheDocument();

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/shotef/monitors");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      monitor: "redis-02: evicted keys above 1k/min",
      solvedByIds: [YONATAN],
      firstFiredAt: "2026-07-01",
      solvedAt: "2026-08-20",
      // Four hours, as the two spans of one control spell it.
      minutesToFix: 240,
    });

    // Newest first, so the new one leads the wall.
    expect(screen.getAllByRole("heading", { level: 3 })[0]).toHaveTextContent(
      "redis-02: evicted keys above 1k/min",
    );
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * The podium and the fastest fix are counted across the whole collection by
   * the database, and there is deliberately no pure second spelling of either
   * on the client. So the optimistic add moves the wall only; both aggregates
   * arrive with the `router.refresh()` behind it.
   */
  it("leaves the podium to the refresh rather than recounting it locally", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    await submit(user);
    await screen.findByText("redis-02: evicted keys above 1k/min");

    // יונתן is on the new plaque, but the board still says what the server
    // last said — one row, מאיה, until the refresh lands.
    const podium = screen.queryByText("מי השתיק הכי הרבה");
    expect(podium).toBeNull(); // a board of one is not a podium
    expect(refresh).toHaveBeenCalled();
  });

  it("re-seeds every number when the refresh hands down a fresh wall", () => {
    const { rerender } = render(
      <SessionProvider user={makeSessionUser()}>
        <HallOfFame initial={wall()} roster={ROSTER} />
      </SessionProvider>,
    );

    expect(screen.getByText("הישג אחד")).toBeInTheDocument();

    rerender(
      <SessionProvider user={makeSessionUser()}>
        <HallOfFame
          initial={wall({
            monitors: [CREATED, PLAQUE],
            board: [
              ...BOARD,
              {
                member: ROSTER[1],
                solved: 1,
                lastSolved: "2026-08-20T00:00:00.000Z",
              },
            ],
          })}
          roster={ROSTER}
        />
      </SessionProvider>,
    );

    expect(screen.getByText("2 הישגים")).toBeInTheDocument();
    // Two rows is a podium, so it is drawn now.
    expect(screen.getByText("מי השתיק הכי הרבה")).toBeInTheDocument();
  });

  it("refuses a certificate with nobody on it, without posting", async () => {
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText(/שם המוניטור/),
      "redis-02: evicted keys above 1k/min",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "תליית התעודה" }),
    );

    expect(
      within(dialog).getByText("צריך לבחור לפחות אדם אחד"),
    ).toBeInTheDocument();
    // Still open, nothing hung on the wall, and nothing sent.
    expect(screen.queryByText("redis-02: evicted keys above 1k/min")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  // The two spans are one control on screen, so an error the server keys to
  // `minutesToFix` has to be rendered on the field the form actually draws.
  it("renders a server 422 on the field the form shows", async () => {
    vi.mocked(fetch).mockImplementation(
      respondWith(
        {
          error: "יש שדות לא תקינים",
          issues: { minutesToFix: "זה כבר לא זמן טיפול" },
        },
        422,
      ),
    );
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await submit(user);

    expect(
      within(dialog).getByText("זה כבר לא זמן טיפול"),
    ).toBeInTheDocument();
    expect(screen.queryByText("redis-02: evicted keys above 1k/min")).toBeNull();
  });

  // The session can lapse while the form is open. The API's 401 is the
  // enforcement; this is just sending them somewhere they can fix it.
  it("bounces to the login page on a 401", async () => {
    vi.mocked(fetch).mockImplementation(
      respondWith({ error: "פג תוקף החיבור" }, 401),
    );
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    await submit(user);

    expect(push).toHaveBeenCalledWith(
      "/login?next=%2Fshotef%2Fhall-of-fame",
    );
    expect(screen.queryByText("redis-02: evicted keys above 1k/min")).toBeNull();
  });

  it("keeps the form open when the server cannot be reached", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const user = open();

    await user.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await submit(user);

    expect(dialog).toBeInTheDocument();
    expect(screen.queryByText("redis-02: evicted keys above 1k/min")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  // Drawn signed out too — see the matching note in `shotef-reviews.test.tsx`.
  it("offers the add button to a signed-out reader as well", () => {
    open(wall(), null);

    expect(
      screen.getByRole("button", { name: /תעודה חדשה/ }),
    ).toBeInTheDocument();
  });

  /**
   * The stat says how many people are up on the wall, so it cannot be read off
   * the board: the board ranks the *current* rotation and drops anyone who has
   * left it, while their plaques — and their names on them — stay. Here three
   * people are named across the wall and only one is still on the board.
   */
  it("counts everyone on the wall, not everyone on the board", () => {
    open(wall({ solverCount: 3 }));

    const stat = screen.getByText("פותרים").closest("div") as HTMLElement;
    expect(within(stat).getByText("3")).toBeInTheDocument();
    expect(within(stat).queryByText(String(BOARD.length))).toBeNull();
  });

  // A fresh database has no certificates, and a signed-out visitor to one needs
  // a way in — the add button above is not drawn for them.
  // A fresh database, read by someone signed out: the empty state says so and
  // the add button above it is still the way in. It no longer carries a login
  // link of its own — the button is drawn for everyone now, so the link would
  // be a second door to the same place.
  it("still offers a way in on an empty wall when signed out", () => {
    open({ monitors: [], board: [], fastest: null, solverCount: 0 }, null);

    expect(screen.getByText("עדיין אין תעודה על הקיר.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /תעודה חדשה/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /כניסה/ })).toBeNull();
  });

  it("names no fastest fix on an empty wall rather than inventing one", () => {
    open({ monitors: [], board: [], fastest: null, solverCount: 0 });

    expect(screen.getByText("0 הישגים")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /כניסה/ })).toBeNull();
  });

  /**
   * §8 on the wall itself: a plaque carries its recipients' resolved names, so
   * someone who was never on the on-call rotation still renders. Looking the
   * name up in `roster` — which is what the fixture-era wall did — would print
   * "לא ידוע" here.
   */
  it("names a recipient who is not on the on-call rotation", () => {
    open(
      wall({
        monitors: [
          {
            ...PLAQUE,
            solvedBy: [{ id: RONIT, name: "רונית אשכנזי" }],
          },
        ],
      }),
    );

    expect(screen.getByText("רונית אשכנזי")).toBeInTheDocument();
    expect(screen.queryByText("לא ידוע")).toBeNull();
  });

  it("lists every name on a certificate more than one person earned", () => {
    open(
      wall({
        monitors: [
          {
            ...PLAQUE,
            solvedBy: [
              { id: MAYA, name: "מאיה גלעד" },
              { id: RONIT, name: "רונית אשכנזי" },
            ],
          },
        ],
      }),
    );

    const plaque = screen
      .getByText("db-prod-01: RAM above 95%")
      .closest("article") as HTMLElement;
    expect(within(plaque).getByText("מאיה גלעד")).toBeInTheDocument();
    expect(within(plaque).getByText("רונית אשכנזי")).toBeInTheDocument();
  });

  // `users` rows are never deleted, so this is the case that should not happen
  // — but a plaque must still sign off on something rather than on nothing.
  it("says לא ידוע rather than signing a plaque with no name", () => {
    open(wall({ monitors: [{ ...PLAQUE, solvedBy: [] }] }));

    expect(screen.getByText("לא ידוע")).toBeInTheDocument();
  });

  it("tells a signed-in reader with an empty rotation where to add people", async () => {
    const actor = userEvent.setup();
    render(
      <SessionProvider user={makeSessionUser()}>
        <HallOfFame initial={wall()} roster={[]} />
      </SessionProvider>,
    );

    await actor.click(screen.getByRole("button", { name: /תעודה חדשה/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/אין אף אחד בתורנות/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "תליית התעודה" }),
    ).toBeNull();
  });
});
