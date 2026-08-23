"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  HeartIcon,
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
  COMMENT_MAX_LENGTH,
  type LikeState,
  type QuoteComment,
} from "@/lib/engagement-schema";
import { formatRelative, plural } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

export function QuoteEngagement({ quote }: { quote: Quote }) {
  const user = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  const [liked, setLiked] = useState(quote.likedByViewer);
  const [likeCount, setLikeCount] = useState(quote.likeCount);
  const [commentCount, setCommentCount] = useState(quote.commentCount);
  const [comments, setComments] = useState(quote.commentsPreview);
  const [expanded, setExpanded] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [liking, setLiking] = useState(false);
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
    setLiked(quote.likedByViewer);
    setLikeCount(quote.likeCount);
    setCommentCount(quote.commentCount);
    if (!expanded) setComments(quote.commentsPreview);
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

  async function toggleLike() {
    if (!user || liking) return;

    const nextLiked = !liked;
    const previousCount = likeCount;
    setLiked(nextLiked);
    setLikeCount(Math.max(0, previousCount + (nextLiked ? 1 : -1)));
    setLiking(true);

    try {
      const response = await fetch(`/api/quotes/${quote.id}/like`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked: nextLiked }),
      });
      if (response.status === 401) {
        sendToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error(await responseMessage(response, "עדכון הלייק נכשל"));
      }

      const state: LikeState = await response.json();
      setLiked(state.likedByViewer);
      setLikeCount(state.likeCount);
      router.refresh();
    } catch (error) {
      setLiked(!nextLiked);
      setLikeCount(previousCount);
      toast.error(
        error instanceof Error ? error.message : "לא הצלחנו לעדכן את הלייק",
      );
    } finally {
      setLiking(false);
    }
  }

  async function loadComments() {
    setLoadingComments(true);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/comments`);
      if (!response.ok) {
        throw new Error(await responseMessage(response, "טעינת התגובות נכשלה"));
      }
      const payload: { comments: QuoteComment[] } = await response.json();
      setComments(payload.comments);
      setCommentCount(payload.comments.length);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "לא הצלחנו לטעון את התגובות",
      );
    } finally {
      setLoadingComments(false);
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
      setComments((current) => [...current, comment]);
      setCommentCount((current) => current + 1);
      setNewText("");
      toast.success("התגובה נוספה");
      router.refresh();
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
        const message = await responseMessage(response, "עדכון התגובה נכשל");
        setEditError(message);
        return;
      }

      const updated: QuoteComment = await response.json();
      setComments((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingId(null);
      toast.success("התגובה עודכנה");
      router.refresh();
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

      setComments((current) =>
        current.filter((item) => item.id !== comment.id),
      );
      setCommentCount((current) => Math.max(0, current - 1));
      if (editingId === comment.id) setEditingId(null);
      toast.success("התגובה נמחקה");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "לא הצלחנו למחוק את התגובה",
      );
    } finally {
      setChangingId(null);
    }
  }

  const likeLabel = plural(likeCount, "לייק אחד", "לייקים");
  const commentLabel = plural(commentCount, "תגובה אחת", "תגובות");
  const collapsedComments = comments.slice(-2);

  return (
    <section
      className="mt-4 border-t pt-3"
      aria-label="לייקים ותגובות"
    >
      <div className="flex flex-wrap items-center gap-1">
        {user ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLike}
            disabled={liking}
            aria-pressed={liked}
            aria-label={`${liked ? "הסרת לייק" : "סימון לייק"} — ${likeLabel}`}
            className={cn(
              "gap-1.5",
              liked ? "text-primary hover:text-primary" : "text-muted-foreground",
            )}
          >
            {liking ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <HeartIcon className={cn("size-4", liked && "fill-current")} />
            )}
            {likeLabel}
          </Button>
        ) : (
          <Link
            href={loginHref}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-muted-foreground gap-1.5",
            )}
            aria-label={`התחברות כדי לסמן לייק — ${likeLabel}`}
          >
            <HeartIcon className="size-4" />
            {likeLabel}
          </Link>
        )}

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
            <form onSubmit={addComment} className="space-y-2 pt-1">
              <label
                htmlFor={`new-comment-${quote.id}`}
                className="text-sm font-medium"
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
                className="min-h-20"
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
      ) : null}
    </section>
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
