import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WhoSaidItGame } from "@/components/who-said-it-game";
import { makeGameRound } from "./factories";

const DANA = makeGameRound();
const OMER = makeGameRound({
  id: "6a0000000000000000000002",
  text: "בואו נדחה את זה",
  correctAuthor: "עומר",
  options: ["עומר", "דנה"],
  context: null,
});

describe("WhoSaidItGame", () => {
  it("shows a question without revealing its details", () => {
    render(<WhoSaidItGame initialRounds={[DANA, OMER]} />);

    expect(screen.getByText(`״${DANA.text}״`)).toBeInTheDocument();
    expect(screen.getByText("שאלה 1 מתוך 2")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "התקדמות במשחק" }),
    ).toHaveAttribute("aria-valuenow", "1");
    expect(screen.queryByText(DANA.context!)).not.toBeInTheDocument();
  });

  it("marks a wrong choice, reveals the answer, and advances", async () => {
    const user = userEvent.setup();
    render(<WhoSaidItGame initialRounds={[DANA, OMER]} />);

    await user.click(screen.getByRole("button", { name: "עומר" }));

    expect(
      screen.getByRole("button", { name: /עומר.*תשובה שגויה/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /דנה.*תשובה נכונה/ }),
    ).toBeDisabled();
    expect(screen.getByText(/לא הפעם.*התשובה היא דנה/)).toBeInTheDocument();
    expect(screen.getByText(DANA.context!)).toBeInTheDocument();
    expect(screen.getByText("0 נקודות")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "לשאלה הבאה" }));

    expect(screen.getByText(`״${OMER.text}״`)).toBeInTheDocument();
    expect(screen.getByText("שאלה 2 מתוך 2")).toBeInTheDocument();
  });

  it("scores correct answers and can start another game", async () => {
    const user = userEvent.setup();
    render(<WhoSaidItGame initialRounds={[DANA, OMER]} />);

    await user.click(screen.getByRole("button", { name: "דנה" }));
    expect(screen.getByText("נקודה אחת")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "לשאלה הבאה" }));

    await user.click(screen.getByRole("button", { name: "עומר" }));
    await user.click(screen.getByRole("button", { name: "לסיכום" }));

    expect(screen.getByText("2 תשובות נכונות מתוך 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "לשחק שוב" }));

    expect(screen.getByText("שאלה 1 מתוך 2")).toBeInTheDocument();
    expect(screen.queryByText("2 תשובות נכונות מתוך 2")).not.toBeInTheDocument();
  });

  it("explains when the wall has too few authors", () => {
    render(<WhoSaidItGame initialRounds={[]} />);

    expect(
      screen.getByText("עוד אין מספיק קולות למשחק"),
    ).toBeInTheDocument();
  });
});
