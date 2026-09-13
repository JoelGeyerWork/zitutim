import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HubHero } from "@/components/hub-hero";
import { HUB } from "@/lib/navigation";

const LONG_FIRST_NAME = "אלכסנדרהמיכאלהברקוביץכהןלוינסון";

describe("HubHero", () => {
  it("puts a long first name in the greeting", () => {
    render(<HubHero firstName={LONG_FIRST_NAME} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(`היי, ${LONG_FIRST_NAME}.`);
    expect(screen.getByText(HUB.description)).toBeInTheDocument();
  });

  // The name is one unbreakable word at 5xl. Without these the heading's
  // min-content inflates the page past `max-w-2xl` and paints through the
  // stone — a layout fact jsdom will not catch, so the classes are the lock.
  it("lets a long first name wrap inside the measure", () => {
    render(<HubHero firstName={LONG_FIRST_NAME} />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("break-words");
    expect(heading.parentElement).toHaveClass("w-full", "min-w-0");
    expect(heading.parentElement?.parentElement).toHaveClass(
      "w-full",
      "min-w-0",
      "max-w-2xl",
    );
  });
});
