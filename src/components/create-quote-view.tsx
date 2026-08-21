"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { QuoteCard } from "@/components/quote-card";
import { QuoteForm } from "@/components/quote-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Quote } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

export function CreateQuoteView() {
  const router = useRouter();
  /** Everything added in this sitting, newest first — instant feedback. */
  const [justAdded, setJustAdded] = useState<Quote[]>([]);

  function handleSuccess(quote: Quote) {
    setJustAdded((current) => [quote, ...current]);
    // Make sure the feed reflects the new quote when the user navigates back.
    router.refresh();
  }

  /** After an inline edit or delete, re-read that one quote and re-sync it. */
  async function handleChanged(id: string) {
    router.refresh();
    try {
      const response = await fetch(`/api/quotes/${id}`);
      if (response.status === 404) {
        setJustAdded((current) => current.filter((item) => item.id !== id));
        return;
      }
      if (!response.ok) return;
      const updated: Quote = await response.json();
      setJustAdded((current) =>
        current.map((item) => (item.id === id ? updated : item)),
      );
    } catch {
      /* the mutation's own toast already reported the failure */
    }
  }

  return (
    <div className="space-y-8">
      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <QuoteForm onSuccess={handleSuccess} />
        </CardContent>
      </Card>

      {justAdded.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">
              נוסף עכשיו ({justAdded.length})
            </h2>
            <Link
              href="/quotes"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "gap-1.5",
              )}
            >
              לפיד
              {/* Deliberately not flipped: in RTL, "onward" points left. */}
              <ArrowLeftIcon className="size-3.5" />
            </Link>
          </div>

          {justAdded.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              onChanged={() => handleChanged(quote.id)}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
