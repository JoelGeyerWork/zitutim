import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WhoSaidItGame } from "@/components/who-said-it-game";
import { makeGameRound } from "./factories";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const DANA = makeGameRound();
const OMER = makeGameRound({
  id: "6a0000000000000000000002",
  text: "בואו נדחה את זה",
  correctAuthor: "עומר",
  options: ["עומר", "דנה"],
  context: null,
});
const ITAI = makeGameRound({
  id: "6a0000000000000000000003",
  text: "אין דבר קבוע יותר מפיצ׳ר זמני",
  correctAuthor: "איתי",
  options: ["איתי", "נועה"],
  context: null,
});

describe("WhoSaidItGame", () => {
  it("shows a question without revealing its details", () => {
    render(<WhoSaidItGame initialRounds={[DANA, OMER]} />);

    expect(screen.getByText(`״${DANA.text}״`)).toBeInTheDocument();
    expect(screen.getByText("שאלה 1 מתוך 2")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "התקדמות במשחק" }),
    ).toHaveAttribute("aria-valuenow", "0");
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
    expect(
      screen.getByRole("progressbar", { name: "התקדמות במשחק" }),
    ).toHaveAttribute("aria-valuenow", "1");
  });

  it("scores a double-click on the right name only once", async () => {
    const user = userEvent.setup();
    render(<WhoSaidItGame initialRounds={[DANA, OMER]} />);

    await user.dblClick(screen.getByRole("button", { name: "דנה" }));

    expect(screen.getByText("נקודה אחת")).toBeInTheDocument();
    expect(screen.queryByText("2 נקודות")).not.toBeInTheDocument();
  });

  it("scores a correct click once under Strict Mode", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <WhoSaidItGame initialRounds={[DANA, OMER]} />
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "דנה" }));

    expect(screen.getByText("נקודה אחת")).toBeInTheDocument();
    expect(screen.queryByText("2 נקודות")).not.toBeInTheDocument();
  });

  it("scores correct answers and asks the server for a new hand", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <WhoSaidItGame initialRounds={[DANA, OMER]} />,
    );

    await user.click(screen.getByRole("button", { name: "דנה" }));
    expect(screen.getByText("נקודה אחת")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "לשאלה הבאה" }));

    await user.click(screen.getByRole("button", { name: "עומר" }));
    await user.click(screen.getByRole("button", { name: "לסיכום" }));

    expect(screen.getByText("2 תשובות נכונות מתוך 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "לשחק שוב" }));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("שאלה 1 מתוך 2")).toBeInTheDocument();
    expect(screen.queryByText("2 תשובות נכונות מתוך 2")).not.toBeInTheDocument();

    rerender(<WhoSaidItGame initialRounds={[ITAI]} />);

    expect(screen.getByText(`״${ITAI.text}״`)).toBeInTheDocument();
    expect(screen.queryByText(`״${DANA.text}״`)).not.toBeInTheDocument();
  });

  it("explains when the wall has too few authors", () => {
    render(<WhoSaidItGame initialRounds={[]} />);

    expect(
      screen.getByText("עוד אין מספיק קולות למשחק"),
    ).toBeInTheDocument();
  });
});
