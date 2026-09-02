"use client";

import { useEffect, useState } from "react";

import { QuoteForm } from "@/components/quote-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Quote } from "@/lib/quote-schema";
import { type Member } from "@/lib/team";

/** `GET /api/rotation`'s public member shape — deliberately no `directoryId`. */
type RotationResponse = {
  members: { userId: string; name: string; title: string; gender: "m" | "f" }[];
};

export function EditQuoteDialog({
  quote,
  open,
  onOpenChange,
  onSaved,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  // The team, so the speaker can be *changed* to another teammate and not only
  // corrected. Without it the one `{ source: "user" }` reference this form could
  // send is the quote's own `authorId`, and swapping to somebody else would
  // demand the directory — the path `resolvePeople` exists to keep working with
  // no domain controller on the network. The card is rendered on public pages,
  // so it arrives over the public `GET /api/rotation` rather than as a prop
  // drilled through the feed: that endpoint answers anonymously and ships no
  // objectGUID, which is exactly the trade `withoutDirectoryId` describes.
  const [roster, setRoster] = useState<Member[]>([]);

  useEffect(() => {
    if (!open) return;

    // Every setState is inside the async callback; the effect body sets none —
    // `react-hooks/set-state-in-effect` is an error in this config.
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/rotation");
        if (cancelled || !response.ok) return;
        const data: RotationResponse = await response.json();
        if (cancelled) return;
        setRoster(
          data.members.map((member) => ({
            id: member.userId,
            name: member.name,
            role: member.title,
            gender: member.gender,
          })),
        );
      } catch {
        // The rotation is a shortcut, not the way in: the quote's own author is
        // already offered and the directory search still finds anyone else.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת ציטוט</DialogTitle>
          <DialogDescription>
            תיקון קטן לניסוח, לשם או לתאריך.
          </DialogDescription>
        </DialogHeader>

        <QuoteForm
          quote={quote}
          roster={roster}
          onCancel={() => onOpenChange(false)}
          onSuccess={() => {
            onOpenChange(false);
            onSaved?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
