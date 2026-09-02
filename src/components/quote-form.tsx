"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { DirectorySearch } from "@/components/directory-search";
import { Field } from "@/components/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { type DirectoryPerson } from "@/lib/directory-schema";
import { todayInputValue, toInputValue } from "@/lib/format";
import {
  directoryRef,
  personKey,
  userRef,
  type PersonRef,
} from "@/lib/person-ref";
import type { Quote, QuoteAuthorRef } from "@/lib/quote-schema";
import { type Member } from "@/lib/team";
import { cn } from "@/lib/utils";

/**
 * Somebody the "מי אמר?" picker can offer, and the reference the server will
 * resolve them by.
 *
 * The team arrives as `users._id` rows and becomes `{ source: "user" }`
 * references — the path that opens no LDAP connection at all, which is what
 * keeps quoting a teammate working with no domain controller on the network.
 * Anyone found in the directory is appended as `{ source: "directory" }`
 * carrying the name the search returned, so the select can label them before
 * this app has ever heard of them.
 */
type Candidate = { key: string; ref: PersonRef; name: string };

function fromRoster(member: Member): Candidate {
  const ref = userRef(member.id);
  return { key: personKey(ref), ref, name: member.name };
}

function fromDirectory(person: DirectoryPerson): Candidate {
  const ref = directoryRef(person.directoryId);
  return { key: personKey(ref), ref, name: person.displayName };
}

/**
 * How the speaker is being named: picked out of the team or the directory, or
 * typed. Typing is the fallback rather than the default, but it does not go
 * away — the wall quotes customers, people from other organisations and people
 * who left years ago, and every quote added before the picker existed has a
 * name and no id, which is exactly what this mode edits.
 */
type AuthorMode = "pick" | "type";

// There is no `addedBy` field any more: attribution comes from the session, so
// asking the browser to remember a name would just be a way to get it wrong.
interface Values {
  text: string;
  /** The picked candidate's `key` — never a name. Empty when nobody is picked. */
  author: string;
  /** The typed name. Only `authorMode: "type"` reads it. */
  authorName: string;
  saidAt: string;
  context: string;
}

function emptyValues(): Values {
  return {
    text: "",
    author: "",
    authorName: "",
    saidAt: todayInputValue(),
    context: "",
  };
}

/** The quote's own author, as the option that is already the answer. */
function currentAuthor(quote?: Quote): Candidate[] {
  if (!quote?.authorId) return [];
  const ref = userRef(quote.authorId);
  return [{ key: personKey(ref), ref, name: quote.author }];
}

export function QuoteForm({
  quote,
  roster = [],
  onSuccess,
  onCancel,
  submitLabel,
  className,
}: {
  /** Present = edit mode; absent = create mode. */
  quote?: Quote;
  /**
   * The names offered without asking, because they are the likely ones — the
   * meetup rotation, which is the team. Not the limit of who may be quoted:
   * anyone else is found through the directory search under the field, and
   * somebody outside the organisation is typed.
   *
   * Optional, and the edit dialog passes none: there the quote's own author is
   * already the standing answer, and drilling the roster through the feed and
   * every card to reach it would buy a shortcut nobody needs.
   */
  roster?: Member[];
  onSuccess?: (quote: Quote) => void;
  onCancel?: () => void;
  submitLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`;

  const seeded = currentAuthor(quote);
  const [values, setValues] = useState<Values>(() =>
    quote ? valuesFrom(quote, seeded[0]) : emptyValues(),
  );
  // A quote whose author has no id — typed, or added before the picker — opens
  // on the name it already carries. Anything else opens on the picker.
  const [authorMode, setAuthorMode] = useState<AuthorMode>(() =>
    quote && !quote.authorId ? "type" : "pick",
  );
  // Whoever the directory has been asked about this sitting, kept so the select
  // goes on labelling a pick after the search panel is closed.
  const [found, setFound] = useState<Candidate[]>([]);
  // Opened by hand, except when there is nobody to offer — an unseeded rotation
  // in the create form, or the edit dialog on a quote with no id — where the
  // search is the only way to name anyone and hiding it behind a link would
  // leave an empty select as the whole field.
  const [searching, setSearching] = useState(
    () => seeded.length + roster.length === 0,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // First occurrence wins, since the quote's own author is usually in the
  // roster too and one person must not be two options.
  const candidates: Candidate[] = [];
  const byKey = new Map<string, Candidate>();
  for (const candidate of [...seeded, ...roster.map(fromRoster), ...found]) {
    if (byKey.has(candidate.key)) continue;
    byKey.set(candidate.key, candidate);
    candidates.push(candidate);
  }

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // Both halves of the author field render one error, under the one label.
    clearError(key === "authorName" ? "author" : key);
  }

  /** A directory result becomes an option, and the answer, in one press. */
  function pickFromDirectory(person: DirectoryPerson) {
    const candidate = fromDirectory(person);
    setFound((current) =>
      current.some((entry) => entry.key === candidate.key)
        ? current
        : [...current, candidate],
    );
    set("author", candidate.key);
    setSearching(false);
  }

  /** Switching to a typed name carries the picked one over as its starting text. */
  function typeInstead() {
    setAuthorMode("type");
    setSearching(false);
    set("authorName", byKey.get(values.author)?.name ?? values.authorName);
  }

  function pickInstead() {
    setAuthorMode("pick");
    clearError("author");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    // Whichever half of the field is on screen, said as the one thing the
    // server takes. Undefined rather than a fabricated reference when nothing
    // is named, so the missing field is reported here rather than 422ing on an
    // id nobody can resolve.
    const author: QuoteAuthorRef | undefined =
      authorMode === "type"
        ? values.authorName.trim()
          ? { source: "name", name: values.authorName.trim() }
          : undefined
        : byKey.get(values.author)?.ref;

    const local: Record<string, string> = {};
    if (!values.text.trim()) local.text = "צריך לכתוב מה נאמר";
    if (!author) local.author = "צריך לציין מי אמר";
    if (!values.saidAt) local.saidAt = "צריך לבחור תאריך";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        quote ? `/api/quotes/${quote.id}` : "/api/quotes",
        {
          method: quote ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: values.text,
            author,
            saidAt: values.saidAt,
            context: values.context,
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      // The session can lapse while the form is open, so send them somewhere
      // they can do something about it rather than just reporting failure.
      if (response.status === 401) {
        toast.error(payload?.error ?? "פג תוקף החיבור");
        router.push(loginHref);
        return;
      }

      if (!response.ok) {
        if (payload?.issues) setErrors(payload.issues);
        toast.error(payload?.error ?? "משהו השתבש");
        return;
      }

      toast.success(quote ? "הציטוט עודכן" : "הציטוט נוסף לקיר");
      if (!quote) {
        // `found` survives on purpose: several quotes from one sitting are
        // often by the same person, and they are already an option.
        setValues(emptyValues());
        setSearching(false);
      }
      onSuccess?.(payload as Quote);
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-5", className)}>
      <Field
        id="text"
        label="מה נאמר?"
        error={errors.text}
        hint={`${values.text.length}/2000`}
      >
        <Textarea
          id="text"
          value={values.text}
          onChange={(event) => set("text", event.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="״תמיד יש זמן לעוד קפה אחד״"
          aria-invalid={Boolean(errors.text)}
          className="resize-y text-base leading-relaxed"
        />
      </Field>

      <Field
        id="author"
        label="מי אמר?"
        hint={
          authorMode === "pick" && roster.length > 0
            ? "הצוות, ומי שנמצא בספרייה"
            : undefined
        }
        error={errors.author}
      >
        {authorMode === "type" ? (
          <div className="space-y-3">
            <Input
              id="author"
              value={values.authorName}
              onChange={(event) => set("authorName", event.target.value)}
              maxLength={120}
              placeholder="שם"
              autoComplete="off"
              aria-invalid={Boolean(errors.author)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={pickInstead}
              className="text-muted-foreground px-0"
            >
              חזרה לבחירה מהצוות ומהספרייה
            </Button>
          </div>
        ) : (
          /* A row of names rather than a select, and not for looks: Base UI's
             `Select` resets a controlled value it cannot find among the items
             registered in its popup (`onMapChange` in SelectPositioner), so
             appending whoever the search found and selecting them in the same
             press un-picks them again the moment the item list changes. The
             certificate dialog names people the same way, for the same reason
             its list also grows. */
          <div id="author" className="space-y-3">
            {candidates.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {candidates.map((candidate) => {
                  const picked = values.author === candidate.key;
                  return (
                    <Button
                      key={candidate.key}
                      type="button"
                      size="sm"
                      variant={picked ? "default" : "outline"}
                      aria-pressed={picked}
                      onClick={() => set("author", candidate.key)}
                      className={cn(!picked && "text-muted-foreground")}
                    >
                      {candidate.name}
                    </Button>
                  );
                })}
              </div>
            ) : null}

            {searching ? (
              <div className="space-y-3 rounded-xl border p-3 sm:p-4">
                <DirectorySearch
                  autoFocus
                  loginHref={loginHref}
                  taken={(person) => values.author === fromDirectory(person).key}
                  action={(person) =>
                    values.author === fromDirectory(person).key ? (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        נבחר
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => pickFromDirectory(person)}
                      >
                        בחירה
                      </Button>
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearching(false)}
                  className="w-full"
                >
                  סגירת החיפוש
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearching(true)}
                  className="text-muted-foreground gap-1.5 px-0"
                >
                  <SearchIcon className="size-3.5" />
                  מי שאמר לא ברשימה? חיפוש בספריית הארגון
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={typeInstead}
                  className="text-muted-foreground px-0"
                >
                  לא מהארגון? כתיבת שם
                </Button>
              </div>
            )}
          </div>
        )}
      </Field>

      <Field id="saidAt" label="מתי?" error={errors.saidAt}>
        <Input
          id="saidAt"
          type="date"
          value={values.saidAt}
          max={todayInputValue()}
          onChange={(event) => set("saidAt", event.target.value)}
          aria-invalid={Boolean(errors.saidAt)}
          className="[&::-webkit-calendar-picker-indicator]:cursor-pointer sm:max-w-56"
        />
      </Field>

      <Field
        id="context"
        label="הקשר"
        optional
        error={errors.context}
        hint="איפה זה קרה, מה הוביל לזה"
      >
        <Input
          id="context"
          value={values.context}
          onChange={(event) => set("context", event.target.value)}
          maxLength={400}
          placeholder="בסטנדאפ של יום שני, אחרי שהבילד נפל בפעם השלישית"
          autoComplete="off"
        />
      </Field>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onCancel}
            disabled={saving}
          >
            ביטול
          </Button>
        ) : null}
        <Button type="submit" size="lg" disabled={saving} className="gap-2">
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {submitLabel ?? (quote ? "שמירת שינויים" : "הוספה לקיר")}
        </Button>
      </div>
    </form>
  );
}

/**
 * An existing quote as the form holds it. The author is either the option it
 * already is — `current`, seeded from `authorId` — or, when there is no id, the
 * plain name to go on editing.
 */
function valuesFrom(quote: Quote, current?: Candidate): Values {
  return {
    text: quote.text,
    author: current?.key ?? "",
    authorName: current ? "" : quote.author,
    saidAt: toInputValue(quote.saidAt),
    context: quote.context ?? "",
  };
}
