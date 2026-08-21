"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ALL_SECTIONS, sectionFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SiteNav() {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const tabs = section?.tabs ?? [];

  return (
    <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
      {/* One row once there is room for one. Below `sm` the tabs drop to their
          own line (`order-last w-full`) rather than being squeezed into a strip
          too narrow to show a whole pill. */}
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-2 px-4 sm:h-16 sm:flex-nowrap">
        <div className="flex h-16 min-w-0 shrink-0 items-center gap-1.5 sm:h-auto">
          <Link href="/" aria-label="מרכז הצוות" className="shrink-0">
            <span className="bg-primary text-primary-foreground quote-mark flex size-9 items-center justify-center rounded-xl pt-2.5 text-3xl font-bold">
              ״
            </span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="min-w-0 gap-1.5 px-2.5 text-base font-bold"
                >
                  {section ? <section.icon className="size-4 shrink-0" /> : null}
                  <span className="truncate">
                    {section?.label ?? "מרכז הצוות"}
                  </span>
                  <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-48">
              <DropdownMenuRadioGroup value={section?.href ?? ""}>
                {ALL_SECTIONS.map(({ href, label, icon: Icon }) => (
                  <DropdownMenuRadioItem
                    key={href}
                    value={href}
                    // A real link, so it keeps open-in-new-tab and the status
                    // bar preview that a JS-driven menu item throws away.
                    render={<Link href={href} />}
                    // Base UI defaults radio items to *staying open* — right
                    // for the theme picker, wrong here: the navigation is
                    // client-side, so without this the menu is left hanging
                    // over the section it just moved you to.
                    closeOnClick
                  >
                    <Icon />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {tabs.length > 1 ? (
          <nav
            aria-label={section?.label}
            // `-mx-1` pulls the pills' own padding back so their labels line up
            // with the page's `px-4` on the wrapped mobile row.
            className="order-last -mx-1 w-full pb-2 sm:order-none sm:mx-0 sm:w-auto sm:min-w-0 sm:flex-1 sm:pb-0"
          >
            {/* Scrolls rather than wraps, so a section can grow a fourth tab
                without the header changing height. */}
            <div className="flex gap-1 overflow-x-auto">
              {tabs.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
            </div>
          </nav>
        ) : null}

        {/* `ms-auto` rather than `justify-between`, so the actions stay pinned
            to the end whether or not the section has tabs to sit beside. */}
        <div className="ms-auto flex h-16 shrink-0 items-center gap-1 sm:h-auto">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
