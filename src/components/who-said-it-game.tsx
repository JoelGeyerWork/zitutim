"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  QuoteIcon,
  RotateCcwIcon,
  TrophyIcon,
  XIcon,
} from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatSaidAt, plural } from "@/lib/format";
import { shuffled, type QuoteGameRound } from "@/lib/quote-schema";
import { cn } from "@/lib/utils";

export function WhoSaidItGame({
  initialRounds,
}: {
  initialRounds: QuoteGameRound[];
}) {
  const router = useRouter();
  const [rounds, setRounds] = useState(initialRounds);
  const [roundIndex, setRoundIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  // router.refresh() re-runs the server component and hands us a new deal.
  // Adjusting during render (rather than in an effect) drops the extra paint.
  const [seed, setSeed] = useState(initialRounds);
  if (seed !== initialRounds) {
    setSeed(initialRounds);
    setRounds(initialRounds);
    setRoundIndex(0);
    setSelected(null);
    setScore(0);
    setFinished(false);
  }

  if (rounds.length === 0) {
    return (
      <Card className="py-10 text-center">
        <CardContent className="mx-auto max-w-sm">
          <QuoteIcon
            className="text-muted-foreground mx-auto mb-4 size-9"
            aria-hidden
          />
          <h2 className="text-lg font-semibold">עוד אין מספיק קולות למשחק</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            אחרי שיופיעו בקיר ציטוטים של לפחות שני אנשים, יהיה אפשר להתחיל
            לנחש.
          </p>
        </CardContent>
      </Card>
    );
  }

  function restart() {
    router.refresh();
    // Local reshuffle so play-again is instant if the refresh is slow or
    // `$sample` happens to return the same quotes.
    setRounds((current) =>
      shuffled(current).map((round) => ({
        ...round,
        options: shuffled(round.options),
      })),
    );
    setRoundIndex(0);
    setSelected(null);
    setScore(0);
    setFinished(false);
  }

  if (finished) {
    const perfect = score === rounds.length;
    const strong = score >= Math.ceil(rounds.length * 0.7);

    return (
      <Card className="py-10 text-center">
        <CardContent className="mx-auto flex max-w-sm flex-col items-center">
          <span className="bg-primary/10 text-primary mb-4 flex size-14 items-center justify-center rounded-full">
            <TrophyIcon className="size-7" aria-hidden />
          </span>
          <h2 className="text-xl font-bold">
            {plural(score, "תשובה נכונה אחת", "תשובות נכונות")} מתוך{" "}
            {rounds.length}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {perfect
              ? "מושלם. כנראה שהיית בחדר כשזה נאמר."
              : strong
                ? "יפה מאוד. קיר הציטוטים לא מצליח להפתיע."
                : "יש עוד כמה פנינים שכדאי להכיר בקיר."}
          </p>
          <Button className="mt-6" size="lg" onClick={restart}>
            <RotateCcwIcon data-icon="inline-start" />
            לשחק שוב
          </Button>
        </CardContent>
      </Card>
    );
  }

  const round = rounds[roundIndex];
  const answered = selected !== null;
  const correct = selected === round.correctAuthor;

  function choose(author: string) {
    setSelected((current) => {
      if (current !== null) return current;
      if (author === round.correctAuthor) {
        setScore((points) => points + 1);
      }
      return author;
    });
  }

  function nextRound() {
    if (roundIndex === rounds.length - 1) {
      setFinished(true);
      return;
    }
    setRoundIndex((current) => current + 1);
    setSelected(null);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4 text-sm">
        <span className="font-medium">
          שאלה {roundIndex + 1} מתוך {rounds.length}
        </span>
        <span className="text-muted-foreground">
          {plural(score, "נקודה אחת", "נקודות")}
        </span>
      </div>
      <div
        className="bg-muted mb-6 h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="התקדמות במשחק"
        aria-valuemin={0}
        aria-valuemax={rounds.length}
        aria-valuenow={roundIndex}
      >
        <div
          className="bg-primary h-full rounded-full transition-[width]"
          style={{ width: `${(roundIndex / rounds.length) * 100}%` }}
        />
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <QuoteIcon className="size-4" aria-hidden />
            מי אמר את זה?
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 py-8 sm:px-8 sm:py-10">
          <blockquote className="text-center text-xl leading-relaxed font-semibold text-balance whitespace-pre-wrap sm:text-2xl">
            ״{round.text}״
          </blockquote>
        </CardContent>

        {answered ? (
          <CardFooter
            className="block px-5 py-4 text-start"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <PersonAvatar name={round.correctAuthor} />
              <div>
                <p className="font-semibold">
                  {correct ? "בול." : "לא הפעם."} התשובה היא{" "}
                  {round.correctAuthor}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatSaidAt(round.saidAt)}
                </p>
              </div>
            </div>
            {round.context ? (
              <p className="text-muted-foreground border-border mt-3 border-t pt-3 text-sm">
                {round.context}
              </p>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {round.options.map((option) => {
          const isCorrect = answered && option === round.correctAuthor;
          const isWrong = answered && selected === option && !isCorrect;

          return (
            <Button
              key={option}
              variant="outline"
              size="lg"
              className={cn(
                "h-auto min-h-12 w-full justify-start px-4 py-3 text-start whitespace-normal disabled:opacity-100",
                isCorrect &&
                  "border-foreground bg-foreground text-background hover:bg-foreground",
                isWrong &&
                  "border-destructive bg-destructive/10 text-destructive",
                answered && !isCorrect && !isWrong && "opacity-50",
              )}
              disabled={answered}
              aria-pressed={selected === option}
              onClick={() => choose(option)}
            >
              <span className="flex-1">{option}</span>
              {isCorrect ? (
                <>
                  <CheckIcon className="size-4" aria-hidden />
                  <span className="sr-only">תשובה נכונה</span>
                </>
              ) : null}
              {isWrong ? (
                <>
                  <XIcon className="size-4" aria-hidden />
                  <span className="sr-only">תשובה שגויה</span>
                </>
              ) : null}
            </Button>
          );
        })}
      </div>

      {answered ? (
        <Button className="mt-5 w-full" size="lg" onClick={nextRound}>
          {roundIndex === rounds.length - 1 ? "לסיכום" : "לשאלה הבאה"}
        </Button>
      ) : (
        <p className="text-muted-foreground mt-5 text-center text-xs">
          בחירת תשובה תחשוף גם את התאריך וההקשר
        </p>
      )}
    </div>
  );
}
