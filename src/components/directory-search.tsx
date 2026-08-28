"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { PersonAvatar } from "@/components/person-avatar";
import { useSession } from "@/components/session-provider";
import { Input } from "@/components/ui/input";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { cn } from "@/lib/utils";

/**
 * Looking somebody up in the organisation's directory.
 *
 * Extracted out of `RotationEditor`, which had the only copy, once the שוטף
 * forms needed the same thing: three debounced searches against the same
 * endpoint, maintained separately, would drift on the debounce, on the
 * two-character floor and on which of loading / empty / errored each one
 * bothers to draw.
 *
 * What it deliberately does *not* know is what picking someone means. The
 * trailing control on a result row is the caller's `action` — an "add to the
 * rotation" button, a "already named on this certificate" badge — because that
 * is the only part that was ever rotation-specific.
 *
 * `DirectoryPerson` is imported from `directory-schema.ts`, never from
 * `ldap.ts`: this is a client component, and `ldap.ts` would drag `ldapts` into
 * the browser bundle.
 */
export function DirectorySearch({
  loginHref,
  action,
  taken,
  autoFocus,
  placeholder = "שם או שם משתמש",
}: {
  /** Where to send someone who has to sign in before they can search. */
  loginHref: string;
  /** The trailing control on a result row — what picking means to the caller. */
  action: (person: DirectoryPerson) => React.ReactNode;
  /** Rows this caller has already taken, dimmed rather than hidden. */
  taken?: (person: DirectoryPerson) => boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const session = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  // Which trimmed query `results`/`errored` describe. "loading" is then a render
  // derivation rather than a synchronous setState in the effect — an error in
  // this config, the same rule `QuoteFeed` works around.
  const [resolvedFor, setResolvedFor] = useState("");
  const [errored, setErrored] = useState(false);

  const trimmed = query.trim();
  const signedIn = Boolean(session);

  useEffect(() => {
    const q = query.trim();
    if (!signedIn || q.length < 2) return;

    // Debounced, so a fast typist issues one request rather than one a keystroke
    // — the two-character floor is also the server's rule. Every setState is
    // inside the async callback; the effect body itself sets none.
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/directory?q=${encodeURIComponent(q)}`,
        );
        if (cancelled) return;
        if (response.status === 401) {
          // Signed in when this rendered, so a 401 means the session lapsed
          // rather than that they never had one — and every write behind this
          // form is about to answer the same way. Sending them somewhere they
          // can fix it beats reporting that the directory is broken.
          router.push(loginHref);
          return;
        }
        if (!response.ok) {
          setResults([]);
          setErrored(true);
          setResolvedFor(q);
          return;
        }
        const data: { people: DirectoryPerson[] } = await response.json();
        if (cancelled) return;
        setResults(data.people);
        setErrored(false);
        setResolvedFor(q);
      } catch {
        if (cancelled) return;
        setResults([]);
        setErrored(true);
        setResolvedFor(q);
      }
    }, 300);

    return () => {
      // Cancelling the debounce is only half of it: a request already in flight
      // outlives the effect that started it, and the responses can land in
      // either order. "ab" answering after "abc" would put `resolvedFor` back
      // on a query nobody is looking at any more — and since `loading` is
      // `resolvedFor !== trimmed`, the box would sit on "מחפשים…" until the
      // next keystroke, over results that are already stale.
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, signedIn, loginHref, router]);

  // `GET /api/directory` is the one read in this app that demands a session, and
  // both שוטף forms are drawn for signed-out readers. Offering a box that can
  // only ever answer 401 — or bouncing them off the page the moment they type a
  // second letter, losing the form they were filling — is worse than saying so.
  if (!signedIn) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm text-balance">
        החיפוש בספריית הארגון פתוח למי שמחובר.{" "}
        <Link href={loginHref} className="text-foreground underline">
          כניסה
        </Link>
      </p>
    );
  }

  const short = trimmed.length < 2;
  // Results and the error flag apply only once they are for the query on screen;
  // until then the search is still in flight.
  const loading = !short && resolvedFor !== trimmed;

  return (
    <div className="min-w-0 space-y-4">
      <div className="relative">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="חיפוש בספריית הארגון"
          className="ps-9"
        />
      </div>

      {short ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          לפחות שתי אותיות.
        </p>
      ) : loading ? (
        <p className="text-muted-foreground py-6 text-center text-sm">מחפשים…</p>
      ) : errored ? (
        // Covers both the 503 and the 500: from here they are the same fact —
        // the directory did not answer — and which of the two it was is a line
        // in the server's log, not something to spell out on a form.
        <p className="text-muted-foreground py-6 text-center text-sm">
          לא הצלחנו לחפש בספרייה.
        </p>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          אין תוצאות בספרייה.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {results.map((person) => (
            <li
              key={person.directoryId}
              className={cn(
                "flex items-center gap-3 px-3 py-3 sm:px-4",
                taken?.(person) && "opacity-55",
              )}
            >
              <PersonAvatar name={person.displayName} className="size-10" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {person.displayName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {person.title ? `${person.title} · ` : null}
                  <span dir="ltr" className="font-mono">
                    {person.username}
                  </span>
                </p>
              </div>

              {action(person)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The note that explains why searching is free of consequence, where it fits. */
export function DirectorySearchNote() {
  return (
    <p className="text-muted-foreground text-xs text-balance">
      החיפוש רץ בחשבון השירות ולא מנסה להזדהות כאף אחד, ולכן אינו נוגע במונה
      הכניסות הכושלות של אף חשבון.
    </p>
  );
}
