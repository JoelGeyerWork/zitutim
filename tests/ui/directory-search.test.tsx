import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DirectorySearch } from "@/components/directory-search";
import { SessionProvider } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { jsonResponse, makeSessionUser } from "./factories";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/shotef/reviews",
}));

const ROI = {
  directoryId: "guid-roi",
  displayName: "רועי אשכנזי",
  title: "אבטחת מידע",
  username: "roi.ashkenazi",
};

const picked = vi.fn();

function search(user = makeSessionUser() as ReturnType<typeof makeSessionUser> | null) {
  const actor = userEvent.setup();
  render(
    <SessionProvider user={user}>
      <DirectorySearch
        loginHref="/login?next=%2Fshotef%2Freviews"
        action={(person) => (
          <Button size="sm" onClick={() => picked(person.directoryId)}>
            הוספה
          </Button>
        )}
      />
    </SessionProvider>,
  );
  return actor;
}

beforeEach(() => {
  push.mockClear();
  picked.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ people: [ROI] })));
});

describe("DirectorySearch", () => {
  it("holds off until the second character, which is the server's rule too", async () => {
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "ר");

    expect(screen.getByText("לפחות שתי אותיות.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hands a result to the caller's own control", async () => {
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    const result = await screen.findByText("רועי אשכנזי");
    await actor.click(
      within(result.closest("li")!).getByRole("button", { name: "הוספה" }),
    );

    expect(picked).toHaveBeenCalledWith("guid-roi");
  });

  // There is no domain controller on this network, and there may be none in
  // production during an outage. The form around this one still works — it is
  // the *addition* — so this has to say so rather than look broken.
  it("says the directory did not answer rather than failing silently", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "לא הצלחנו לחפש בספריית הארגון" }, 503),
    );
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    expect(
      await screen.findByText("לא הצלחנו לחפש בספרייה."),
    ).toBeInTheDocument();
  });

  it("says the same for a server that was never configured", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "החיפוש בספרייה לא מוגדר בשרת" }, 500),
    );
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    expect(
      await screen.findByText("לא הצלחנו לחפש בספרייה."),
    ).toBeInTheDocument();
  });

  it("tells an empty answer apart from a failed one", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ people: [] }));
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    expect(await screen.findByText("אין תוצאות בספרייה.")).toBeInTheDocument();
  });

  // Signed in when this rendered, so a 401 is the session lapsing — and every
  // write behind the form is about to answer the same way.
  it("sends a lapsed session to the login page", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "פג תוקף החיבור" }, 401),
    );
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/login?next=%2Fshotef%2Freviews"),
    );
  });

  // `GET /api/directory` is the one read here that refuses to answer
  // anonymously, so a box that could only ever 401 is worse than saying so.
  it("offers a signed-out reader the login page instead of a box", async () => {
    search(null);

    expect(
      screen.queryByLabelText("חיפוש בספריית הארגון"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כניסה" })).toHaveAttribute(
      "href",
      "/login?next=%2Fshotef%2Freviews",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
