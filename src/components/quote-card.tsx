"use client";

import { useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { DeleteQuoteDialog } from "@/components/delete-quote-dialog";
import { EditQuoteDialog } from "@/components/edit-quote-dialog";
import { toneFor } from "@/components/person-avatar";
import { QuoteEngagement } from "@/components/quote-engagement";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function copy() {
    const payload = `״${quote.text}״\n— ${quote.author}, ${formatSaidAt(quote.saidAt)}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast.success("הציטוט הועתק");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("ההעתקה נכשלה");
    }
  }

  const copyLabel = copied ? "הציטוט הועתק" : "העתקת הציטוט";

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

        <div className="ms-auto flex shrink-0 items-center gap-1">
          {/* Hidden when signed out because the actions would only 401 — this is
              presentation, not a permission check. The API is the boundary. */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100"
                    aria-label="אפשרויות נוספות"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-40">
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
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={copy}
            className="text-muted-foreground hover:text-primary size-8"
            aria-label={copyLabel}
            title={copyLabel}
          >
            {copied ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </Button>
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
