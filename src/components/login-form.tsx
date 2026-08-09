"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";

import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeNext } from "@/lib/auth-schema";

export function LoginForm({ next }: { next?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const local: Record<string, string> = {};
    if (!username.trim()) local.username = "צריך שם משתמש";
    if (!password) local.password = "צריך סיסמה";
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFailure(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (payload?.issues) setErrors(payload.issues);
        // Deliberately not a toast, unlike every other form here: a login error
        // has to stay on screen while you retype, and a toast auto-dismisses.
        else setFailure(payload?.error ?? "משהו השתבש");
        setPassword("");
        return;
      }

      // The nav lives in the root layout, which a client navigation would not
      // re-render — refresh first, or you land signed in with a "כניסה" button.
      router.refresh();
      router.replace(safeNext(next));
    } catch {
      setFailure("אין חיבור לשרת");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {failure ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm font-medium"
        >
          {failure}
        </p>
      ) : null}

      <Field id="username" label="שם משתמש" error={errors.username}>
        <Input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={256}
          // AD usernames are Latin. Inside an RTL page an LTR field needs the
          // direction spelled out, or the caret and placeholder sit wrong.
          dir="ltr"
          autoComplete="username"
          autoFocus
          aria-invalid={Boolean(errors.username)}
        />
      </Field>

      <Field id="password" label="סיסמה" error={errors.password}>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={512}
          dir="ltr"
          // Never autoComplete="off" here: it breaks password managers, which
          // makes people pick worse passwords.
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
        />
      </Field>

      {/* People are about to type their Windows password into a web page and
          are entitled to know that is what is happening. */}
      <p className="text-muted-foreground text-xs">
        מתחברים עם שם המשתמש והסיסמה של הרשת
      </p>

      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="w-full gap-2"
      >
        {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
        כניסה
      </Button>
    </form>
  );
}
