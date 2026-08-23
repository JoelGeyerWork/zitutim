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
vi.mock("next/navigation", () => ({
  usePathname: () => "/quotes",
  useRouter: () => ({ refresh }),
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
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("QuoteEngagement", () => {
  it("shows counts and only the latest-two collapsed preview", () => {
    const first = makeComment({ id: "1", text: "תגובה ראשונה" });
    const second = makeComment({ id: "2", text: "תגובה שנייה" });
    const third = makeComment({ id: "3", text: "תגובה שלישית" });

    render(
      <QuoteEngagement
        quote={makeQuote({
          likeCount: 4,
          commentCount: 3,
          commentsPreview: [second, third],
        })}
      />,
    );

    expect(screen.getByText("4 לייקים")).toBeInTheDocument();
    expect(screen.getByText("3 תגובות")).toBeInTheDocument();
    expect(screen.queryByText(first.text)).not.toBeInTheDocument();
    const preview = screen.getByRole("list", { name: "תגובות אחרונות" });
    expect(within(preview).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual([
        `${second.authorName}: ${second.text}`,
        `${third.authorName}: ${third.text}`,
      ]);
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
      screen.getByRole("link", { name: /התחברות כדי לסמן לייק/ }),
    ).toHaveAttribute("href", "/login?next=%2Fquotes");

    await user.click(screen.getByRole("button", { name: "תגובה אחת" }));
    expect(await screen.findByText(comment.text)).toBeInTheDocument();
    expect(screen.queryByLabelText("הוספת תגובה")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "להתחבר" })).toHaveAttribute(
      "href",
      "/login?next=%2Fquotes",
    );
  });

  it("optimistically toggles a signed-in like and reconciles the response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ likeCount: 1, likedByViewer: false }),
    );
    const user = userEvent.setup();
    renderSignedIn(
      <QuoteEngagement
        quote={makeQuote({ likeCount: 2, likedByViewer: true })}
      />,
    );

    const button = screen.getByRole("button", { name: /הסרת לייק/ });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.click(button);

    await waitFor(() => expect(screen.getByText("לייק אחד")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quotes/6a0000000000000000000001/like",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ liked: false }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("loads the full conversation and adds a comment inline", async () => {
    const old = makeComment({ id: "1", text: "ישנה" });
    const added = makeComment({ id: "2", text: "תגובה חדשה" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ comments: [old] }))
      .mockResolvedValueOnce(jsonResponse(added, 201));
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
      .mockResolvedValueOnce(jsonResponse(null, 204));
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
