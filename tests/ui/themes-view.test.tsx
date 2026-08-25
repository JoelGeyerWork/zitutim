import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemesView } from "@/components/themes-view";
import {
  makeStanding,
  makeTheme,
  makeThemeMember,
  respondWith,
} from "./factories";
import type { Standing, Theme, ThemeMember, ThemePage } from "@/lib/theme-schema";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const MEMBERS: ThemeMember[] = [
  makeThemeMember({ id: "m1", name: "נועה ברקת", gender: "f" }),
  makeThemeMember({ id: "m2", name: "אורי בן־חיים", role: "דאטה", gender: "m" }),
];

function page(themes: Theme[], overrides: Partial<ThemePage> = {}): ThemePage {
  return { themes, total: themes.length, hasMore: false, ...overrides };
}

function view(props: {
  initial: ThemePage;
  standings?: Standing[];
  stats?: { total: number; solved: number };
}) {
  return (
    <ThemesView
      initial={props.initial}
      standings={props.standings ?? []}
      stats={props.stats ?? { total: props.initial.total, solved: 0 }}
      members={MEMBERS}
      nowIso="2026-08-18T09:00:00.000Z"
      defaultBroughtById="m1"
    />
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(respondWith(page([])));
  vi.stubGlobal("fetch", fetchMock);
});

describe("ThemesView", () => {
  it("renders the brought-by snapshot on each card, not a resolved name", () => {
    const themes = [
      makeTheme({ id: "1", broughtBy: "נועה ברקת", theme: "הכול עגול" }),
    ];
    render(view({ initial: page(themes) }));

    expect(screen.getByText("הכול עגול")).toBeInTheDocument();
    expect(screen.getAllByText("נועה ברקת").length).toBeGreaterThan(0);
  });

  it("shows the leaderboard from props rather than deriving it from the page", () => {
    // The page holds a single unsolved theme, but the standings say otherwise —
    // proving the board is not computed over the loaded page.
    const standings = [
      makeStanding({ id: "m2", name: "אורי בן־חיים", guesses: 5 }),
      makeStanding({ id: "m1", name: "נועה ברקת", guesses: 0 }),
    ];
    render(
      view({
        initial: page([makeTheme({ id: "1", guessedById: null })]),
        standings,
      }),
    );

    expect(screen.getByText("טבלת המנחשים")).toBeInTheDocument();
    // The 5 comes only from the standings prop.
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("names the guesser from the snapshot with a gender-neutral verb", () => {
    // The guesser is not in the current roster, which used to force a masculine
    // fallback on the card. "נוחש על ידי" agrees with the theme, not the person,
    // so a departed guesser of any gender reads right — no roster lookup at all.
    const themes = [
      makeTheme({
        id: "1",
        guessedById: "gone",
        guessedBy: "דנה כהן",
      }),
    ];
    render(view({ initial: page(themes) }));

    expect(screen.getByText("דנה כהן")).toBeInTheDocument();
    expect(screen.getByText(/נוחש על ידי/)).toBeInTheDocument();
  });

  it("re-seeds the history when a fresh initial prop arrives", () => {
    const first = [
      makeTheme({ id: "1", theme: "הכול עגול" }),
      makeTheme({ id: "2", theme: "מקסיקו", date: "2026-08-11T00:00:00.000Z" }),
    ];
    const { rerender } = render(view({ initial: page(first) }));
    expect(screen.getByText("מקסיקו")).toBeInTheDocument();

    // router.refresh() after a delete elsewhere hands down new props.
    rerender(view({ initial: page([first[0]]) }));
    expect(screen.queryByText("מקסיקו")).not.toBeInTheDocument();
    expect(screen.getByText("הכול עגול")).toBeInTheDocument();
  });

  it("lays the history out two cards to a row from sm", () => {
    const themes = [
      makeTheme({ id: "1", theme: "הכול עגול" }),
      makeTheme({ id: "2", theme: "מקסיקו", date: "2026-08-11T00:00:00.000Z" }),
    ];
    const { container } = render(view({ initial: page(themes) }));
    const grid = container.querySelector(".sm\\:grid-cols-2");

    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll("article")).toHaveLength(2);
  });

  it("reports the total and solved count from the stats prop", () => {
    render(
      view({
        initial: page([makeTheme({ id: "1" })]),
        stats: { total: 10, solved: 8 },
      }),
    );
    expect(screen.getByText(/10 נושאים/)).toBeInTheDocument();
    expect(screen.getByText(/8 נוחשו/)).toBeInTheDocument();
  });

  it("exposes a search bar above the history and no clear button yet", () => {
    render(view({ initial: page([makeTheme({ id: "1" })]) }));
    expect(screen.getByLabelText("חיפוש נושאים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניקוי החיפוש" })).toBeNull();
  });

  it("sends the typed term as ?q=", async () => {
    const round = makeTheme({ id: "1", theme: "הכול עגול" });
    const mexico = makeTheme({
      id: "2",
      theme: "מקסיקו",
      date: "2026-08-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(view({ initial: page([round, mexico]) }));

    fetchMock.mockImplementation(respondWith(page([mexico])));
    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");

    await waitFor(() =>
      expect(requestedUrls().at(-1)).toContain(
        `q=${encodeURIComponent("מקסיקו")}`,
      ),
    );
    expect(await screen.findByText("מקסיקו")).toBeInTheDocument();
    expect(screen.queryByText("הכול עגול")).not.toBeInTheDocument();
  });

  it("shows an empty state naming the term", async () => {
    const user = userEvent.setup();
    render(view({ initial: page([makeTheme({ id: "1" })]) }));

    fetchMock.mockImplementation(respondWith(page([])));
    await user.type(screen.getByLabelText("חיפוש נושאים"), "בלתי אפשרי");

    expect(
      await screen.findByText(/אין תוצאות ל״בלתי אפשרי״/),
    ).toBeInTheDocument();
  });

  it("clears the term and restores the initial list without fetching", async () => {
    const round = makeTheme({ id: "1", theme: "הכול עגול" });
    const mexico = makeTheme({
      id: "2",
      theme: "מקסיקו",
      date: "2026-08-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(view({ initial: page([round, mexico]) }));

    fetchMock.mockImplementation(respondWith(page([mexico])));
    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");
    expect(await screen.findByText(/תוצאה אחת עבור/)).toBeInTheDocument();

    fetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: "ניקוי החיפוש" }));

    expect(screen.getByLabelText("חיפוש נושאים")).toHaveValue("");
    expect(screen.getByText("הכול עגול")).toBeInTheDocument();
    expect(screen.getByText("מקסיקו")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces typing into a single request", async () => {
    const user = userEvent.setup();
    render(view({ initial: page([makeTheme({ id: "1" })]) }));
    fetchMock.mockClear();

    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // Six keystrokes must not mean six round trips.
    expect(fetchMock.mock.calls.length).toBeLessThan(6);
  });

  it("highlights the matched term in the results", async () => {
    const mexico = makeTheme({ id: "2", theme: "מקסיקו" });
    fetchMock.mockImplementation(respondWith(page([mexico])));
    const user = userEvent.setup();
    render(view({ initial: page([makeTheme({ id: "1" }), mexico]) }));

    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");
    await waitFor(() => {
      const mark = document.querySelector("mark");
      expect(mark?.textContent).toBe("מקסיקו");
    });
  });

  it("leaves the leaderboard in place while the history filters", async () => {
    const standings = [
      makeStanding({ id: "m2", name: "אורי בן־חיים", guesses: 5 }),
    ];
    const mexico = makeTheme({ id: "2", theme: "מקסיקו" });
    fetchMock.mockImplementation(respondWith(page([mexico])));
    const user = userEvent.setup();
    render(
      view({
        initial: page([makeTheme({ id: "1" }), mexico]),
        standings,
      }),
    );

    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");
    expect(
      await screen.findByText("תוצאה אחת עבור ״מקסיקו״"),
    ).toBeInTheDocument();
    expect(screen.getByText("טבלת המנחשים")).toBeInTheDocument();
    expect(screen.getByText("אורי בן־חיים")).toBeInTheDocument();
  });

  it("loads the next unfiltered page, skipping what is already shown", async () => {
    const first = makeTheme({ id: "1", theme: "הכול עגול" });
    const second = makeTheme({
      id: "2",
      theme: "מקסיקו",
      date: "2026-08-11T00:00:00.000Z",
    });
    fetchMock.mockImplementation(respondWith(page([second], { total: 2 })));
    const user = userEvent.setup();
    render(view({ initial: page([first], { total: 2, hasMore: true }) }));

    await user.click(screen.getByRole("button", { name: "עוד נושאים" }));

    expect(await screen.findByText("מקסיקו")).toBeInTheDocument();
    expect(requestedUrls()[0]).toContain("skip=1");
    expect(requestedUrls()[0]).not.toContain("q=");
  });

  it("keeps q= when loading more search results, without duplicating", async () => {
    const first = makeTheme({ id: "1", theme: "עגול אחד" });
    const second = makeTheme({
      id: "2",
      theme: "עגול שניים",
      date: "2026-08-11T00:00:00.000Z",
    });
    const user = userEvent.setup();
    render(view({ initial: page([first, second]) }));

    fetchMock.mockImplementation(
      respondWith(page([first], { total: 2, hasMore: true })),
    );
    await user.type(screen.getByLabelText("חיפוש נושאים"), "עגול");
    expect(
      await screen.findByText("2 תוצאות עבור ״עגול״"),
    ).toBeInTheDocument();
    expect(screen.queryByText("עגול שניים")).not.toBeInTheDocument();

    // Server repeats the first hit alongside the new one; it must appear once.
    fetchMock.mockImplementation(
      respondWith(page([first, second], { total: 2, hasMore: false })),
    );
    await user.click(screen.getByRole("button", { name: "עוד נושאים" }));

    await waitFor(() =>
      expect(requestedUrls().at(-1)).toContain("skip=1"),
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(requestedUrls().at(-1)).toContain(`q=${encodeURIComponent("עגול")}`);
  });

  it("reports a failed search instead of hanging on the previous list", async () => {
    const user = userEvent.setup();
    render(
      view({ initial: page([makeTheme({ id: "1", theme: "הכול עגול" })]) }),
    );

    fetchMock.mockRejectedValue(new Error("offline"));
    await user.type(screen.getByLabelText("חיפוש נושאים"), "מקסיקו");

    expect(
      await screen.findByText(/אין תוצאות ל״מקסיקו״/),
    ).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText("הכול עגול")).not.toBeInTheDocument();
  });
});
