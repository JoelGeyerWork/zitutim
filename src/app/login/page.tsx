import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { Card, CardContent } from "@/components/ui/card";
import { getSession, safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "כניסה",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : null);

  const user = await getSession();
  if (user) redirect(target);

  return (
    <div className="mx-auto max-w-md px-4 py-10 md:py-16">
      <header className="mb-6 space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">כניסה</h1>
        {/* Section-neutral, for the same reason `UNAUTHORIZED_MESSAGE` is: every
            write control in the app is drawn signed-out and bounces here off a
            401, so this page is reached from סיכום חדש and תעודה חדשה just as
            often as from the quote wall. Naming one section strands the rest. */}
        <p className="text-muted-foreground text-sm">
          הקריאה פתוחה לכולם — כניסה נדרשת כדי להוסיף ולערוך
        </p>
      </header>

      <Card>
        <CardContent>
          <LoginForm next={target} />
        </CardContent>
      </Card>
    </div>
  );
}
