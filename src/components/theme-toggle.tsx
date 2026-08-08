"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { LaptopIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEMES = [
  { value: "light", label: "בהיר", icon: SunIcon },
  { value: "dark", label: "כהה", icon: MoonIcon },
  { value: "system", label: "לפי המערכת", icon: LaptopIcon },
] as const;

const NO_OP_SUBSCRIBE = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The server has no way to know the stored theme, so the icon can only be
  // decided after hydration. Render the neutral sun until then. A store that
  // never changes gives us "am I on the client?" without a setState effect,
  // which this config rejects.
  const mounted = useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => true,
    () => false,
  );

  const current = THEMES.find(({ value }) => value === theme) ?? THEMES[2];
  const Icon = mounted ? current.icon : SunIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground size-9 shrink-0"
            aria-label="ערכת נושא"
          >
            <Icon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={mounted ? current.value : undefined}
          onValueChange={setTheme}
        >
          {THEMES.map(({ value, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
