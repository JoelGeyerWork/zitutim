import { render, screen } from "@testing-library/react";
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(respondWith(page([]))));
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
});
