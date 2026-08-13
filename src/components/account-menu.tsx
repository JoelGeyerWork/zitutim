"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { toast } from "sonner";

import { useSession } from "@/components/session-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authorTone, initial } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Same tints the quote cards use, so the account avatar matches the wall. */
const TONES = [
  "bg-primary/10 text-primary",
  "bg-foreground/10 text-foreground",
  "bg-primary/20 text-primary",
  "bg-foreground/[0.06] text-muted-foreground",
  "bg-primary/[0.07] text-primary",
] as const;

export function AccountMenu() {
  const user = useSession();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) {
    // Styled as a button but left as a real link — this navigates, and
    // `<Button render={<Link/>}>` would put role="button" on the anchor. Same
    // approach as the other call-to-action links (see page.tsx, quote-feed.tsx).
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
      >
        כניסה
      </Link>
    );
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // Reload rather than router.refresh(), for the same reason login uses a
      // full navigation: the Router Cache is holding signed-in renders of every
      // route already visited. Staying on the current URL is deliberate — if it
      // needs a session, the server bounces to /login, which is correct.
      window.location.reload();
    } catch {
      toast.error("אין חיבור לשרת");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label="החשבון שלי"
          >
            <Avatar size="sm">
              <AvatarFallback className={TONES[authorTone(user.name)]}>
                {initial(user.name)}
              </AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-48">
        {/* DropdownMenuLabel is Base UI's Menu.GroupLabel and has to sit inside
            a Group. Outside one it throws while the popup renders, so the menu
            just silently never opens — not the error you would expect. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="text-foreground block font-semibold">
              {user.name}
            </span>
            <span className="block text-xs" dir="ltr">
              {user.username}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} disabled={signingOut}>
          <LogOutIcon />
          יציאה
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
