import { render, screen, waitFor, within } from "@testing-library/react";
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

  // Two requests in flight, answering in the wrong order. The debounce cancels
  // a *pending* request, not one already sent, so this is reachable by typing.
  it("ignores a slow answer to a query that has been typed past", async () => {
    const inflight: Array<{ q: string; send: (people: unknown[]) => void }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const q = new URL(url, "http://localhost").searchParams.get("q")!;
        return new Promise<Response>((resolve) => {
          inflight.push({ q, send: (people) => resolve(jsonResponse({ people })) });
        });
      }),
    );

    const actor = search();
    const box = screen.getByLabelText("חיפוש בספריית הארגון");

    await actor.type(box, "רו");
    await waitFor(() => expect(inflight).toHaveLength(1));

    await actor.type(box, "עי");
    await waitFor(() => expect(inflight).toHaveLength(2));
    expect(inflight.map((call) => call.q)).toEqual(["רו", "רועי"]);

    // The query on screen answers first, then the one already typed past.
    inflight[1].send([ROI]);
    expect(await screen.findByText("רועי אשכנזי")).toBeInTheDocument();

    inflight[0].send([{ ...ROI, directoryId: "guid-stale", displayName: "רות שגב" }]);

    // The stale answer neither replaces the list nor puts the box back on
    // "מחפשים…", which is where `resolvedFor` regressing to "רו" would leave it.
    await waitFor(() => {
      expect(screen.queryByText("רות שגב")).not.toBeInTheDocument();
      expect(screen.queryByText("מחפשים…")).not.toBeInTheDocument();
    });
    expect(screen.getByText("רועי אשכנזי")).toBeInTheDocument();
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

  // The one failure the reader can act on, so it does not get folded into the
  // generic message with the other two.
  it("tells a search that timed out apart, and says what to do about it", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      jsonResponse({ error: "החיפוש ארך זמן רב מדי. נסו חיפוש ממוקד יותר" }, 504),
    );
    const actor = search();

    await actor.type(screen.getByLabelText("חיפוש בספריית הארגון"), "רועי");

    expect(
      await screen.findByText("החיפוש ארך זמן רב מדי. נסו שם מלא יותר."),
    ).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לחפש בספרייה.")).toBeNull();
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
