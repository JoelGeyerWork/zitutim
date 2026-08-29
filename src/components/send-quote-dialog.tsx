"use client";

import { useState } from "react";
import { Loader2Icon, MailIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Quote } from "@/lib/quote-schema";

/**
 * Confirms before mailing a quote to the whole team list.
 *
 * The confirmation is the point: one stray click on a menu item reaches every
 * colleague's inbox, and there is no unsending it. The dialog is also what
 * makes the in-flight state visible, so a double-click can't send twice.
 */
export function SendQuoteDialog({
  quote,
  open,
  onOpenChange,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/send`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        toast.error(payload?.error ?? "השליחה נכשלה");
        return;
      }

      const payload = await response.json().catch(() => null);
      toast.success(
        payload?.dryRun
          ? "מצב הרצה יבשה — המייל נבנה אבל לא נשלח"
          : "הציטוט נשלח לצוות",
      );
      onOpenChange(false);
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setSending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // The in-flight lock is state in this component, and the card unmounts
        // the dialog on close — so letting Escape through mid-send throws the
        // lock away and the next click sends a second copy to the whole team.
        // Exactly what the confirmation exists to prevent.
        if (!next && sending) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary">
            <MailIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>לשלוח את הציטוט לצוות?</AlertDialogTitle>
          <AlertDialogDescription>
            הציטוט של {quote.author} יישלח לרשימת התפוצה של הצוות, עם קובץ
            להדפסה מצורף. אי אפשר לבטל שליחה.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={sending}>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSend}
            disabled={sending}
            className="gap-2"
          >
            {sending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            שליחה
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
