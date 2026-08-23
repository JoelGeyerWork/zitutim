"use client";

import { useState } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
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

export function DeleteQuoteDialog({
  quote,
  open,
  onOpenChange,
  onDeleted,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/quotes/${quote.id}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null);
        toast.error(payload?.error ?? "המחיקה נכשלה");
        return;
      }

      toast.success("הציטוט נמחק");
      onOpenChange(false);
      onDeleted?.();
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>למחוק את הציטוט?</AlertDialogTitle>
          <AlertDialogDescription>
            הציטוט של {quote.author}, הלייקים והתגובות שלו יימחקו לצמיתות. אי
            אפשר לבטל את הפעולה.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-2"
          >
            {deleting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            מחיקה
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
