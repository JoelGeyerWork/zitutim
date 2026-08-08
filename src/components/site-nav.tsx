"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon, QuoteIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "פיד", icon: QuoteIcon },
  { href: "/search", label: "חיפוש", icon: SearchIcon },
  { href: "/create", label: "ציטוט חדש", icon: PlusIcon },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <>
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="bg-primary text-primary-foreground quote-mark flex size-9 items-center justify-center rounded-xl pt-2.5 text-3xl font-bold">
              ״
            </span>
            <span className="text-lg font-bold tracking-tight">ציטוטים</span>
          </Link>

          {/* Desktop nav. On mobile this collapses to the bottom bar below. */}
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <nav className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-2xl">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
