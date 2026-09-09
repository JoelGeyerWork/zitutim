import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { QuoteEngagement } from "@/components/quote-engagement";
import { SessionProvider } from "@/components/session-provider";
import {
  jsonResponse,
  makeComment,
  makeQuote,
  makeSessionUser,
} from "./factories";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes",
  useRouter: () => ({ push, refresh }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function renderSignedIn(ui: React.ReactElement) {
  return render(
    <SessionProvider user={makeSessionUser()}>{ui}</SessionProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  refresh.mockReset();
  push.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("QuoteEngagement", () => {
  it("shows counts and only the latest-two collapsed preview", () => {
    const first = makeComment({ id: "1", text: "תגובה ראשונה" });
    const second = makeComment({ id: "2", text: "תגובה שנייה" });
    const third = makeComment({ id: "3", text: "תגובה שלישית" });

    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({
          reactions: { "♦️": 4, "😂": 1 },
          commentCount: 3,
          commentsPreview: [second, third],
        })}
      />,
    );

    expect(
      screen.getByRole("group", { name: "דירוג הציטוט — 5 דירוגים" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("טוב — 4 דירוגים")).toHaveTextContent("4");
    expect(screen.getByLabelText("צחקתי קצת — דירוג אחד")).toHaveTextContent("1");
    // An emoji nobody picked stays on the bar, without a count beside it.
    expect(screen.getByLabelText("אליט — 0 דירוגים")).toHaveTextContent("🃏");
    expect(screen.getByText("3 תגובות")).toBeInTheDocument();
    expect(screen.queryByText(first.text)).not.toBeInTheDocument();
    const preview = screen.getByRole("list", { name: "תגובות אחרונות" });
    expect(within(preview).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual([
        `${second.authorName}: ${second.text}`,
        `${third.authorName}: ${third.text}`,
      ]);
  });

  it("keeps the comments disclosure target mounted while collapsed", () => {
    const quote = makeQuote();
    render(<QuoteEngagement quote={quote} />);

    const toggle = screen.getByRole("button", { name: "0 תגובות" });
    const targetId = toggle.getAttribute("aria-controls");

    expect(targetId).toBe(`comments-${quote.id}`);
    expect(document.getElementById(targetId!)).toHaveAttribute("hidden");
  });

  it("sends anonymous engagement attempts to login but keeps comments public", async () => {
    const comment = makeComment();
    fetchMock.mockResolvedValue(
      jsonResponse({ comments: [comment] }),
    );
    const user = userEvent.setup();

    render(
      <QuoteEngagement
        quote={makeQuote({ commentCount: 1, commentsPreview: [comment] })}
      />,
    );

    expect(
      screen.getByRole("link", { name: /התחברות כדי לדרג טוב/ }),
    ).toHaveAttribute("href", "/login?next=%2Fquotes");

    await user.click(screen.getByRole("button", { name: "תגובה אחת" }));
    expect(await screen.findByText(comment.text)).toBeInTheDocument();
    expect(screen.queryByLabelText("הוספת תגובה")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "להתחבר" })).toHaveAttribute(
      "href",
      "/login?next=%2Fquotes",
    );
  });

  it("optimistically swaps a signed-in reaction and reconciles the response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        counts: { "♦️": 1, "😂": 1, "🃏": 3 },
        viewerReaction: "😂",
      }),
    );
    const user = userEvent.setup();
    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({
          reactions: { "♦️": 2, "🃏": 3 },
          viewerReaction: "♦️",
        })}
      />,
    );

    expect(screen.getByLabelText("טוב — 2 דירוגים")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByLabelText("צחקתי קצת — 0 דירוגים"));

    // One person, one reaction: the ♦️ is given up as the 😂 is taken.
    await waitFor(() => {
      expect(screen.getByLabelText("צחקתי קצת — דירוג אחד")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByLabelText("טוב — דירוג אחד")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quotes/6a0000000000000000000001/reaction",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ emoji: "😂" }),
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("withdraws the reaction already picked rather than re-sending it", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ counts: {}, viewerReaction: null }),
    );
    const user = userEvent.setup();
    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ reactions: { "♦️": 1 }, viewerReaction: "♦️" })}
      />,
    );

    await user.click(screen.getByLabelText("טוב — דירוג אחד"));

    await waitFor(() => {
      expect(screen.getByLabelText("טוב — 0 דירוגים")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quotes/6a0000000000000000000001/reaction",
      expect.objectContaining({ body: JSON.stringify({ emoji: null }) }),
    );
  });

  it("rolls back an optimistic reaction before redirecting on an expired session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "צריך להתחבר" }, 401));
    const user = userEvent.setup();
    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ reactions: { "♦️": 2 }, viewerReaction: null })}
      />,
    );

    await user.click(screen.getByLabelText("טוב — 2 דירוגים"));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/login?next=%2Fquotes");
    });
    expect(screen.getByLabelText("טוב — 2 דירוגים")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("loads the full conversation and adds a comment inline", async () => {
    const old = makeComment({ id: "1", text: "ישנה" });
    const added = makeComment({ id: "2", text: "תגובה חדשה" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ comments: [old] }))
      .mockResolvedValueOnce(jsonResponse(added, 201))
      .mockResolvedValueOnce(jsonResponse({ comments: [old, added] }));
    const user = userEvent.setup();

    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ commentCount: 1, commentsPreview: [old] })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "תגובה אחת" }));
    await screen.findByText(old.text);

    await user.type(screen.getByLabelText("הוספת תגובה"), added.text);
    await user.click(screen.getByRole("button", { name: "שליחה" }));

    expect(await screen.findByText(added.text)).toBeInTheDocument();
    expect(screen.getByText("2 תגובות")).toBeInTheDocument();
    expect(screen.getByLabelText("הוספת תגובה")).toHaveValue("");
    expect(toast.success).toHaveBeenCalledWith("התגובה נוספה");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores an older comment load after an overlapping comment creation", async () => {
    const old = makeComment({ id: "1", text: "ישנה" });
    const added = makeComment({ id: "2", text: "תגובה חדשה" });
    let resolveInitialLoad!: (response: Response) => void;
    const initialLoad = new Promise<Response>((resolve) => {
      resolveInitialLoad = resolve;
    });
    fetchMock
      .mockImplementationOnce(() => initialLoad)
      .mockResolvedValueOnce(jsonResponse(added, 201))
      .mockResolvedValueOnce(jsonResponse({ comments: [old, added] }));
    const user = userEvent.setup();

    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ commentCount: 1, commentsPreview: [old] })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "תגובה אחת" }));
    await user.type(screen.getByLabelText("הוספת תגובה"), added.text);
    await user.click(screen.getByRole("button", { name: "שליחה" }));

    expect(await screen.findByText(added.text)).toBeInTheDocument();
    resolveInitialLoad(jsonResponse({ comments: [old] }));

    await waitFor(() => {
      expect(screen.getAllByText(added.text)).toHaveLength(1);
      expect(screen.getByText("2 תגובות")).toBeInTheDocument();
    });
  });

  it("keeps a failed full-thread load visibly retryable", async () => {
    const preview = makeComment({ text: "תגובה אחרונה" });
    const older = makeComment({ id: "2", text: "תגובה ישנה" });
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: "לא הצלחנו לטעון את התגובות" }, 500),
      )
      .mockResolvedValueOnce(
        jsonResponse({ comments: [older, preview] }),
      );
    const user = userEvent.setup();

    render(
      <QuoteEngagement
        quote={makeQuote({
          commentCount: 2,
          commentsPreview: [preview],
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "2 תגובות" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ייתכן שמוצגות כאן רק התגובות האחרונות",
    );
    await user.click(screen.getByRole("button", { name: "ניסיון נוסף" }));

    expect(await screen.findByText(older.text)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not call a complete local thread partial after a re-sync failure", async () => {
    const old = makeComment({ id: "1", text: "ישנה" });
    const added = makeComment({ id: "2", text: "תגובה חדשה" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ comments: [old] }))
      .mockResolvedValueOnce(jsonResponse(added, 201))
      .mockResolvedValueOnce(
        jsonResponse({ error: "רענון התגובות נכשל" }, 500),
      );
    const user = userEvent.setup();

    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ commentCount: 1, commentsPreview: [old] })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "תגובה אחת" }));
    await screen.findByText(old.text);
    await user.type(screen.getByLabelText("הוספת תגובה"), added.text);
    await user.click(screen.getByRole("button", { name: "שליחה" }));

    expect(await screen.findByText(added.text)).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("רענון התגובות נכשל");
    expect(alert).not.toHaveTextContent(
      "ייתכן שמוצגות כאן רק התגובות האחרונות",
    );
    expect(screen.getByText("2 תגובות")).toBeInTheDocument();
  });

  it("offers edit and delete only on the viewer's own comments", async () => {
    const own = makeComment({ id: "1", text: "שלי" });
    const other = makeComment({
      id: "2",
      authorId: "6b0000000000000000000002",
      authorName: "נועה לוי",
      text: "של נועה",
    });
    const edited = { ...own, text: "שלי בעריכה", updatedAt: "2026-08-20T10:00:00.000Z" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ comments: [own, other] }))
      .mockResolvedValueOnce(jsonResponse(edited))
      .mockResolvedValueOnce(jsonResponse({ comments: [edited, other] }))
      .mockResolvedValueOnce(jsonResponse(null, 204))
      .mockResolvedValueOnce(jsonResponse({ comments: [other] }));
    const user = userEvent.setup();

    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({
          commentCount: 2,
          commentsPreview: [own, other],
        })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "2 תגובות" }));
    await screen.findByText(other.text);

    expect(
      screen.getByRole("button", { name: `עריכת התגובה של ${own.authorName}` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `עריכת התגובה של ${other.authorName}`,
      }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: `עריכת התגובה של ${own.authorName}`,
      }),
    );
    const edit = screen.getByLabelText("עריכת תגובה");
    await user.clear(edit);
    await user.type(edit, edited.text);
    await user.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(edited.text)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: `מחיקת התגובה של ${own.authorName}`,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(edited.text)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("תגובה אחת")).toBeInTheDocument();
  });

  it("keeps comment text and surfaces the server error when creation fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ comments: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "לא הצלחנו לשמור את התגובה" }, 500),
      );
    const user = userEvent.setup();
    renderSignedIn(<QuoteEngagement quote={makeQuote()} />);

    await user.click(screen.getByRole("button", { name: "0 תגובות" }));
    const input = screen.getByLabelText("הוספת תגובה");
    await user.type(input, "תגובה שלא נשמרה");
    await user.click(screen.getByRole("button", { name: "שליחה" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("לא הצלחנו לשמור את התגובה");
    expect(input).toHaveValue("תגובה שלא נשמרה");
  });
});
