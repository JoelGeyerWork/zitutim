import type { Metadata } from "next";

import { PageHeader, PageShell } from "@/components/page-shell";
import { WhoSaidItGame } from "@/components/who-said-it-game";
import { getQuoteGame } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "מי אמר את זה?",
};

export default async function QuoteGamePage() {
  const rounds = await getQuoteGame();

  return (
    <PageShell>
      <PageHeader
        title="מי אמר את זה?"
        description="הציטוטים מוכרים. השמות קצת פחות."
      />
      <WhoSaidItGame initialRounds={rounds} />
    </PageShell>
  );
}
