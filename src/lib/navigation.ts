import {
  CalendarDaysIcon,
  HomeIcon,
  LightbulbIcon,
  ListOrderedIcon,
  PlusIcon,
  QuoteIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * The hub's shape, in one place.
 *
 * Navigation is exactly two levels — the dropdown picks a section, the tabs
 * move around inside it — and both read from here, as does the hub's list of
 * cards. Adding a section is one entry in `SECTIONS` plus its route folder;
 * nothing else has to be touched for it to appear everywhere.
 *
 * Client-safe on purpose: `site-nav.tsx` is a client component.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type Section = NavItem & {
  /** One line, used on the section's hub card. */
  description: string;
  /** The pages inside the section. One entry means no tab bar is drawn. */
  tabs: NavItem[];
};

/**
 * The landing page. It sits in the picker like a section, but owns no content
 * of its own — it lists the others, so it is kept out of `SECTIONS`.
 */
export const HUB: Section = {
  href: "/",
  label: "בית",
  description: "מה קורה אצלנו השבוע",
  icon: HomeIcon,
  tabs: [],
};

/**
 * Order matters and is deliberate: it is the order of the dropdown *and* of the
 * hub's cards. The meetup leads because it is the one thing here that expires —
 * everything else reads the same tomorrow.
 */
export const SECTIONS: Section[] = [
  {
    href: "/meetups",
    label: "ישבצ״ים",
    description: "ישיבת צוות אחת בשבוע, וכיבוד שמתחלף בכל פעם",
    icon: CalendarDaysIcon,
    tabs: [
      { href: "/meetups", label: "התור", icon: ListOrderedIcon },
      { href: "/meetups/themes", label: "נושאי הכיבוד", icon: LightbulbIcon },
    ],
  },
  {
    href: "/quotes",
    label: "ציטוטים",
    description: "מי אמר משהו, מתי, ומה הוביל לזה",
    icon: QuoteIcon,
    tabs: [
      { href: "/quotes", label: "הפיד", icon: QuoteIcon },
      { href: "/quotes/search", label: "חיפוש", icon: SearchIcon },
      { href: "/quotes/create", label: "ציטוט חדש", icon: PlusIcon },
    ],
  },
];

/** Everything the section dropdown offers, the hub included. */
export const ALL_SECTIONS: Section[] = [HUB, ...SECTIONS];

/**
 * A section owns its whole subtree — but `/` is a prefix of every path, so the
 * root has to match exactly or it lights up everywhere. The `/` boundary check
 * matters too: a future `/quoteshub` is not inside `/quotes`.
 */
export function sectionFor(pathname: string): Section | undefined {
  if (pathname === HUB.href) return HUB;

  return SECTIONS.find(
    (section) =>
      pathname === section.href || pathname.startsWith(`${section.href}/`),
  );
}
