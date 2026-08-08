import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "ערכת נושא" }));
  return user;
}

afterEach(() => {
  // next-themes writes on the real <html>, which persists between tests.
  document.documentElement.className = "";
});

describe("ThemeToggle", () => {
  it("offers light, dark and system", async () => {
    renderToggle();
    await openMenu();

    for (const label of ["בהיר", "כהה", "לפי המערכת"]) {
      expect(
        await screen.findByRole("menuitemradio", { name: label }),
      ).toBeVisible();
    }
  });

  it("puts the dark class on <html> when dark is picked", async () => {
    renderToggle();
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitemradio", { name: "כהה" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("takes the dark class back off for light", async () => {
    localStorage.setItem("theme", "dark");
    renderToggle();
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitemradio", { name: "בהיר" }));

    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("marks the stored theme as the selected one", async () => {
    localStorage.setItem("theme", "dark");
    renderToggle();
    await openMenu();

    expect(
      await screen.findByRole("menuitemradio", { name: "כהה" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
