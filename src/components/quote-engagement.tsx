"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  applyReaction,
  COMMENT_MAX_LENGTH,
  REACTION_EMOJI,
  REACTION_LABELS,
  reactionTotal,
  type QuoteComment,
  type ReactionCounts,
  type ReactionEmoji,
  type ReactionState,
} from "@/lib/engagement-schema";
import { formatRelative, plural } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

export function QuoteEngagement({ quote }: { quote: Quote }) {
  const user = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  const [reactions, setReactions] = useState(quote.reactions);
  const [viewerReaction, setViewerReaction] = useState(quote.viewerReaction);
  const [commentState, setCommentState] = useState({
    count: quote.commentCount,
    comments: quote.commentsPreview,
  });
  const { count: commentCount, comments } = commentState;
  const [commentsComplete, setCommentsComplete] = useState(
    quote.commentCount === quote.commentsPreview.length,
  );
  const [expanded, setExpanded] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<{
    message: string;
    mayBeIncomplete: boolean;
  } | null>(null);
  const commentsRequest = useRef(0);
  // Which emoji is mid-flight: it marks the chip to spin, and the whole bar is
  // disabled meanwhile. A second press before the first answers would roll back
  // to counts the first press had already moved.
  const [pendingEmoji, setPendingEmoji] = useState<ReactionEmoji | null>(null);
  const [newText, setNewText] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);

  // A router refresh hands the card a fresh quote object. Reconcile counts
  // during render, like QuoteFeed does, without discarding an open conversation
  // that already contains more than the server's two-comment preview.
  const [seed, setSeed] = useState(quote);
  if (seed !== quote) {
    setSeed(quote);
    setReactions(quote.reactions);
    setViewerReaction(quote.viewerReaction);
    setCommentsComplete(
      expanded
        ? commentsComplete && quote.commentCount === commentCount
        : quote.commentCount === quote.commentsPreview.length,
    );
    setCommentState((current) => ({
      count: quote.commentCount,
      comments: expanded ? current.comments : quote.commentsPreview,
    }));
  }

  async function responseMessage(
    response: Response,
    fallback: string,
  ): Promise<string> {
    const payload = await response.json().catch(() => null);
    return payload?.issues?.text ?? payload?.error ?? fallback;
  }

  function sendToLogin() {
    router.push(loginHref);
  }

  /**
   * One person, one reaction: picking the emoji already chosen withdraws it,
   * and picking another swaps rather than adds. The request sends the desired
   * end state, so a retry after a failure is safe.
   */
  async function react(emoji: ReactionEmoji) {
    if (!user || pendingEmoji) return;

    const previousReaction = viewerReaction;
    const previousCounts = reactions;
    const next = previousReaction === emoji ? null : emoji;

    setViewerReaction(next);
    setReactions(applyReaction(previousCounts, previousReaction, next));
    setPendingEmoji(emoji);

    function rollBack() {
      setViewerReaction(previousReaction);
      setReactions(previousCounts);
    }

    try {
      const response = await fetch(`/api/quotes/${quote.id}/reaction`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: next }),
      });
      if (response.status === 401) {
        rollBack();
        sendToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error(await responseMessage(response, "עדכון הדירוג נכשל"));
      }

      const state: ReactionState = await response.json();
      setViewerReaction(state.viewerReaction);
      setReactions(state.counts);
    } catch (error) {
      rollBack();
      toast.error(
        error instanceof Error ? error.message : "לא הצלחנו לעדכן את הדירוג",
      );
    } finally {
      setPendingEmoji(null);
    }
  }

  async function loadComments() {
    const request = ++commentsRequest.current;
    setLoadingComments(true);
    setCommentsError(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/comments`);
      if (!response.ok) {
        throw new Error(await responseMessage(response, "טעינת התגובות נכשלה"));
      }
      const payload: { comments: QuoteComment[] } = await response.json();
      if (request !== commentsRequest.current) return;
      setCommentsComplete(true);
      setCommentState({
        count: payload.comments.length,
        comments: payload.comments,
      });
    } catch (error) {
      if (request !== commentsRequest.current) return;
      const message =
        error instanceof Error ? error.message : "לא הצלחנו לטעון את התגובות";
      setCommentsError({
        message,
        mayBeIncomplete: !commentsComplete,
      });
      toast.error(message);
    } finally {
      if (request === commentsRequest.current) setLoadingComments(false);
    }
  }

  function toggleComments() {
    const opening = !expanded;
    setExpanded(opening);
    if (opening) void loadComments();
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || posting) return;

    const text = newText.trim();
    if (!text) {
      setNewError("צריך לכתוב תגובה");
      return;
    }

    setPosting(true);
    setNewError(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.status === 401) {
        sendToLogin();
        return;
      }
      if (!response.ok) {
        const message = await responseMessage(response, "שמירת התגובה נכשלה");
        setNewError(message);
        return;
      }

      const comment: QuoteComment = await response.json();
      commentsRequest.current += 1;
      setCommentState((current) => {
        const existing = current.comments.findIndex(
          (item) => item.id === comment.id,
        );
        if (existing !== -1) {
          return {
            ...current,
            comments: current.comments.map((item, index) =>
              index === existing ? comment : item,
            ),
          };
        }
        return {
          count: current.count + 1,
          comments: [...current.comments, comment],
        };
      });
      setNewText("");
      toast.success("התגובה נוספה");
      void loadComments();
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setPosting(false);
    }
  }

  function startEditing(comment: QuoteComment) {
    setEditingId(comment.id);
    setEditText(comment.text);
    setEditError(null);
  }

  async function saveComment(
    event: FormEvent<HTMLFormElement>,
    comment: QuoteComment,
  ) {
    event.preventDefault();
    if (changingId) return;

    const text = editText.trim();
    if (!text) {
      setEditError("צריך לכתוב תגובה");
      return;
    }

    setChangingId(comment.id);
    setEditError(null);
    try {
      const response = await fetch(
        `/api/quotes/${quote.id}/comments/${comment.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        },
      );
      if (response.status === 401) {
        sendToLogin();
        return;
      }
      if (!response.ok) {
        const message = await responseMessage(response, "עדכון הדירוג נכשל");
        setEditError(message);
        return;
      }

      const updated: QuoteComment = await response.json();
      commentsRequest.current += 1;
      setCommentState((current) => ({
        ...current,
        comments: current.comments.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      }));
      setEditingId(null);
      toast.success("התגובה עודכנה");
      void loadComments();
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setChangingId(null);
    }
  }

  async function removeComment(comment: QuoteComment) {
    if (changingId) return;
    setChangingId(comment.id);
    try {
      const response = await fetch(
        `/api/quotes/${quote.id}/comments/${comment.id}`,
        { method: "DELETE" },
      );
      if (response.status === 401) {
        sendToLogin();
        return;
      }
      if (!response.ok && response.status !== 404) {
        throw new Error(await responseMessage(response, "מחיקת התגובה נכשלה"));
      }

      commentsRequest.current += 1;
      setCommentState((current) => {
        const comments = current.comments.filter(
          (item) => item.id !== comment.id,
        );
        return {
          count:
            comments.length === current.comments.length
              ? current.count
              : Math.max(0, current.count - 1),
          comments,
        };
      });
      if (editingId === comment.id) setEditingId(null);
      toast.success("התגובה נמחקה");
      void loadComments();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "לא הצלחנו למחוק את התגובה",
      );
    } finally {
      setChangingId(null);
    }
  }

  const commentLabel = plural(commentCount, "תגובה אחת", "תגובות");
  const collapsedComments = comments.slice(-2);

  return (
    <section
      className="mt-4 border-t pt-3"
      aria-label="דירוגים ותגובות"
    >
      <div className="flex flex-wrap items-center gap-1">
        <ReactionBar
          counts={reactions}
          viewerReaction={viewerReaction}
          pendingEmoji={pendingEmoji}
          signedIn={!!user}
          loginHref={loginHref}
          onReact={react}
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleComments}
          aria-expanded={expanded}
          aria-controls={`comments-${quote.id}`}
          className="text-muted-foreground gap-1.5"
        >
          <MessageCircleIcon className="size-4" />
          {commentLabel}
        </Button>
      </div>

      {!expanded && collapsedComments.length > 0 ? (
        <CommentList comments={collapsedComments} preview />
      ) : null}

      {expanded ? (
        <div
          id={`comments-${quote.id}`}
          className="mt-3 space-y-3"
          aria-busy={loadingComments}
        >
          <h3 className="sr-only">תגובות לציטוט</h3>

          {commentsError ? (
            <div
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-sm"
              role="alert"
            >
              <p>{commentsError.message}</p>
              {commentsError.mayBeIncomplete ? (
                <p className="mt-1 text-xs">
                  ייתכן שמוצגות כאן רק התגובות האחרונות.
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadComments()}
                disabled={loadingComments}
              >
                {loadingComments ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                ניסיון נוסף
              </Button>
            </div>
          ) : null}

          {loadingComments && comments.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              טוענים תגובות…
            </p>
          ) : comments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              עוד אין תגובות. אפשר להתחיל את השיחה.
            </p>
          ) : (
            <ol className="space-y-2">
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="bg-muted/60 rounded-xl px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {comment.authorName}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatRelative(comment.createdAt)}
                        {comment.updatedAt !== comment.createdAt
                          ? " · נערכה"
                          : ""}
                      </p>
                    </div>

                    {user?.id === comment.authorId ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => startEditing(comment)}
                          disabled={changingId === comment.id}
                          aria-label={`עריכת התגובה של ${comment.authorName}`}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => void removeComment(comment)}
                          disabled={changingId === comment.id}
                          aria-label={`מחיקת התגובה של ${comment.authorName}`}
                          className="text-destructive hover:text-destructive"
                        >
                          {changingId === comment.id &&
                          editingId !== comment.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <Trash2Icon />
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {editingId === comment.id ? (
                    <form
                      onSubmit={(event) => void saveComment(event, comment)}
                      className="mt-2 space-y-2"
                    >
                      <Textarea
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        maxLength={COMMENT_MAX_LENGTH}
                        aria-label="עריכת תגובה"
                        aria-invalid={!!editError}
                        className="min-h-20"
                        autoFocus
                      />
                      {editError ? (
                        <p className="text-destructive text-xs" role="alert">
                          {editError}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          disabled={changingId === comment.id}
                        >
                          {changingId === comment.id ? (
                            <Loader2Icon className="animate-spin" />
                          ) : null}
                          שמירה
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={changingId === comment.id}
                        >
                          ביטול
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="mt-1 text-sm whitespace-pre-wrap">
                      {comment.text}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          {user ? (
            <form
              onSubmit={addComment}
              className="bg-muted/60 flex flex-col gap-3 rounded-xl p-4"
            >
              <label
                htmlFor={`new-comment-${quote.id}`}
                className="block text-sm font-medium"
              >
                הוספת תגובה
              </label>
              <Textarea
                id={`new-comment-${quote.id}`}
                value={newText}
                onChange={(event) => {
                  setNewText(event.target.value);
                  if (newError) setNewError(null);
                }}
                placeholder="מה רצית לומר?"
                maxLength={COMMENT_MAX_LENGTH}
                aria-invalid={!!newError}
                className="min-h-20 bg-background px-3 py-2.5 dark:bg-background"
              />
              {newError ? (
                <p className="text-destructive text-xs" role="alert">
                  {newError}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={posting || !newText.trim()}
                >
                  {posting ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <SendIcon />
                  )}
                  שליחה
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-muted-foreground text-sm">
              כדי להגיב צריך{" "}
              <Link href={loginHref} className="text-primary underline">
                להתחבר
              </Link>
              .
            </p>
          )}
        </div>
      ) : (
        <div id={`comments-${quote.id}`} hidden />
      )}
    </section>
  );
}

/**
 * The whole scale is drawn at every count, including zero: the emoji are the
 * only thing telling a reader what the grades even are, so hiding the unpicked
 * ones would leave a quote nobody rated with no way to start.
 *
 * Signed out the chips are links to the login page rather than hidden, exactly
 * as the share control is — the API's 401 is the boundary, not the markup.
 */
function ReactionBar({
  counts,
  viewerReaction,
  pendingEmoji,
  signedIn,
  loginHref,
  onReact,
}: {
  counts: ReactionCounts;
  viewerReaction: ReactionEmoji | null;
  pendingEmoji: ReactionEmoji | null;
  signedIn: boolean;
  loginHref: string;
  onReact: (emoji: ReactionEmoji) => void;
}) {
  const total = reactionTotal(counts);

  function chipClass(picked: boolean) {
    return cn(
      "h-8 gap-1 rounded-full border px-2",
      picked
        ? "border-primary bg-primary/10 text-primary hover:text-primary"
        : "text-muted-foreground border-transparent",
    );
  }

  return (
    <div
      role="group"
      aria-label={`דירוג הציטוט — ${plural(total, "דירוג אחד", "דירוגים")}`}
      className="flex flex-wrap items-center gap-0.5"
    >
      {REACTION_EMOJI.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const picked = viewerReaction === emoji;
        const label = REACTION_LABELS[emoji];
        const countLabel = plural(count, "דירוג אחד", "דירוגים");
        // The glyph is decorative to a screen reader — the label names it.
        const face = (
          <>
            <span aria-hidden className="text-base leading-none">
              {emoji}
            </span>
            {pendingEmoji === emoji ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : count > 0 ? (
              <span className="text-xs tabular-nums">{count}</span>
            ) : null}
          </>
        );

        return signedIn ? (
          <Button
            key={emoji}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReact(emoji)}
            disabled={pendingEmoji !== null}
            aria-pressed={picked}
            aria-label={`${label} — ${countLabel}`}
            className={chipClass(picked)}
          >
            {face}
          </Button>
        ) : (
          <Link
            key={emoji}
            href={loginHref}
            aria-label={`התחברות כדי לדרג ${label} — ${countLabel}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              chipClass(false),
            )}
          >
            {face}
          </Link>
        );
      })}
    </div>
  );
}

function CommentList({
  comments,
  preview = false,
}: {
  comments: QuoteComment[];
  preview?: boolean;
}) {
  return (
    <ol
      className={cn(
        "mt-2 space-y-1.5",
        preview && "border-s-2 ps-3",
      )}
      aria-label={preview ? "תגובות אחרונות" : undefined}
    >
      {comments.map((comment) => (
        <li key={comment.id} className="text-sm">
          <span className="font-semibold">{comment.authorName}: </span>
          <span className="text-muted-foreground whitespace-pre-wrap">
            {comment.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
