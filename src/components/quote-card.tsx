"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  CopyIcon,
  DownloadIcon,
  MailIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { DeleteQuoteDialog } from "@/components/delete-quote-dialog";
import { EditQuoteDialog } from "@/components/edit-quote-dialog";
import { SendQuoteDialog } from "@/components/send-quote-dialog";
import { toneFor } from "@/components/person-avatar";
import { QuoteEngagement } from "@/components/quote-engagement";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelative, formatSaidAt, initial } from "@/lib/format";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

export function QuoteCard({
  quote,
  highlight,
  onChanged,
}: {
  quote: Quote;
  /** Search term to mark inside the quote text. */
  highlight?: string;
  /** Called after an edit or delete so the list can refresh. */
  onChanged?: () => void;
}) {
  const user = useSession();
  const pathname = usePathname();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  async function copy() {
    const payload = `״${quote.text}״\n— ${quote.author}, ${formatSaidAt(quote.saidAt)}`;
    try {
      await navigator.clipboard.writeText(payload);
      // No checkmark state any more: the menu closes on click, so the toast is
      // the only feedback that would actually be seen.
      toast.success("הציטוט הועתק");
    } catch {
      toast.error("ההעתקה נכשלה");
    }
  }

  const downloadLabel = "הורד";
  const sendLabel = "שלח";
  // Not shown: the item reads "שלח" like the signed-in one, but a screen reader
  // should still say where it actually goes.
  const sendLoginLabel = "התחברות כדי לשלוח";

  return (
    <article className="bg-card group relative rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md">
      <header className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full text-lg font-bold",
            toneFor(quote.author),
          )}
          aria-hidden
        >
          {initial(quote.author)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{quote.author}</p>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="inline-flex items-center gap-1">
              <CalendarIcon className="size-3" />
              {formatSaidAt(quote.saidAt)}
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden>·</span>
              <span title={`נוסף ${formatRelative(quote.createdAt)}`}>
                נוסף {formatRelative(quote.createdAt)}
              </span>
            </span>
            {quote.addedBy ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden>·</span>
                <span>נוסף על ידי {quote.addedBy}</span>
              </span>
            ) : null}
          </p>
        </div>

        {/* Every action lives behind the one trigger, so the card reads as a
            quote rather than a toolbar. The menu is drawn for signed-out
            visitors too: copying and downloading need no session, and sharing
            routes them to sign-in rather than vanishing. */}
        <div className="ms-auto shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  /* Revealed on hover from `sm` up, but always visible below it:
                     touch devices have no hover, and this is now the only way
                     to reach any of these actions. */
                  className="text-muted-foreground size-8 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:data-popup-open:opacity-100"
                  aria-label="אפשרויות נוספות"
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onClick={copy}>
                <CopyIcon />
                העתק
              </DropdownMenuItem>

              {/* A plain <a>, never a <Link>: the response is an attachment, and
                  routing it through the client router would navigate instead of
                  download. */}
              <DropdownMenuItem
                render={
                  <a href={`/api/quotes/${quote.id}/document`} download />
                }
              >
                <DownloadIcon />
                {downloadLabel}
              </DropdownMenuItem>

              {user ? (
                <DropdownMenuItem onClick={() => setSending(true)}>
                  <MailIcon />
                  {sendLabel}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  render={<Link href={loginHref} />}
                  aria-label={sendLoginLabel}
                >
                  <MailIcon />
                  {sendLabel}
                </DropdownMenuItem>
              )}

              {user ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon />
                    עריכה
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2Icon />
                    מחיקה
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <blockquote className="relative mt-4 text-lg leading-relaxed font-medium text-balance whitespace-pre-wrap">
        <Highlighted text={quote.text} term={highlight} />
      </blockquote>

      {quote.context ? (
        <p className="text-muted-foreground border-primary/40 mt-3 border-s-2 ps-3 text-sm">
          {quote.context}
        </p>
      ) : null}

      <QuoteEngagement quote={quote} />

      {/* Mounted only while open so the form always starts from fresh data. */}
      {editing ? (
        <EditQuoteDialog
          quote={quote}
          open
          onOpenChange={setEditing}
          onSaved={onChanged}
        />
      ) : null}
      {deleting ? (
        <DeleteQuoteDialog
          quote={quote}
          open
          onOpenChange={setDeleting}
          onDeleted={onChanged}
        />
      ) : null}
      {sending ? (
        <SendQuoteDialog quote={quote} open onOpenChange={setSending} />
      ) : null}
    </article>
  );
}

/** Wraps every case-insensitive occurrence of `term` in a <mark>. */
function Highlighted({ text, term }: { text: string; term?: string }) {
  const needle = term?.trim();
  if (!needle) return <>{text}</>;

  const pattern = new RegExp(
    `(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );

  // split() with a capture group puts the matches at the odd indices.
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="bg-primary/20 text-foreground rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
