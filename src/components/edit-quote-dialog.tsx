"use client";

import { QuoteForm } from "@/components/quote-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Quote } from "@/lib/quote-schema";

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
