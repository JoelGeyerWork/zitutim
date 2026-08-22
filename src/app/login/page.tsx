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
        <p className="text-muted-foreground text-sm">
          כדי להוסיף ציטוטים ולערוך אותם
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
