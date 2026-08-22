import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/login-form";
import { makeSessionUser, respondWith } from "./factories";

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi
    .fn()
    .mockImplementation(respondWith({ user: makeSessionUser() }));
  vi.stubGlobal("fetch", fetchMock);

  // jsdom's location.assign is a no-op that warns; replace it so the navigation
  // can be asserted.
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
});

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  username = "dana",
  password = "correct-horse",
) {
  await user.type(screen.getByLabelText(/שם משתמש/), username);
  await user.type(screen.getByLabelText(/סיסמה/), password);
  await user.click(screen.getByRole("button", { name: "כניסה" }));
}

describe("LoginForm", () => {
  it("posts the credentials to the login endpoint", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      username: "dana",
      password: "correct-horse",
    });
  });

  it("masks the password field", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/סיסמה/)).toHaveAttribute("type", "password");
  });

  it("renders both credential fields left-to-right", () => {
    // Latin credentials inside an RTL page: without an explicit direction the
    // caret and placeholder sit on the wrong side.
    render(<LoginForm />);
    expect(screen.getByLabelText(/שם משתמש/)).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText(/סיסמה/)).toHaveAttribute("dir", "ltr");
  });

  it("says which password is being asked for", () => {
    render(<LoginForm />);
    expect(
      screen.getByText("מתחברים עם שם המשתמש והסיסמה של הרשת"),
    ).toBeInTheDocument();
  });

  it("blocks submission with Hebrew messages when fields are empty", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "כניסה" }));

    expect(await screen.findByText("צריך שם משתמש")).toBeInTheDocument();
    expect(screen.getByText("צריך סיסמה")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a failed login on screen rather than toasting it", async () => {
    // A toast auto-dismisses; the message has to stay visible while retyping.
    fetchMock.mockImplementation(
      respondWith({ error: "שם המשתמש או הסיסמה שגויים" }, 401),
    );
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("שם המשתמש או הסיסמה שגויים");
    expect(alert).toBeInTheDocument();
  });

  it("clears the password but keeps the username after a failure", async () => {
    fetchMock.mockImplementation(respondWith({ error: "שגוי" }, 401));
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/שם משתמש/)).toHaveValue("dana");
    expect(screen.getByLabelText(/סיסמה/)).toHaveValue("");
  });

  it("renders per-field issues from a 422", async () => {
    fetchMock.mockImplementation(
      respondWith(
        { error: "יש שדות לא תקינים", issues: { username: "שם ארוך מדי" } },
        422,
      ),
    );
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    expect(await screen.findByText("שם ארוך מדי")).toBeInTheDocument();
  });

  it("surfaces a throttle message", async () => {
    fetchMock.mockImplementation(
      respondWith(
        { error: "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות" },
        429,
      ),
    );
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    expect(
      await screen.findByText(
        "יותר מדי ניסיונות. כדאי לנסות שוב בעוד כמה דקות",
      ),
    ).toBeInTheDocument();
  });

  it("does a full page load so the whole tree re-renders signed in", async () => {
    // Not router.replace(): the client Router Cache is holding renders of
    // routes visited or prefetched while signed out, and router.refresh() is
    // fire-and-forget, so a client navigation lands on a stale layout still
    // showing "כניסה".
    const user = userEvent.setup();
    render(<LoginForm next="/quotes/create" />);
    await signIn(user);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/quotes/create"));
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["absolute", "https://evil.com"],
    ["backslash-normalised", "/\\evil.com"],
  ])("refuses to redirect to an %s target", async (_label, next) => {
    const user = userEvent.setup();
    render(<LoginForm next={next} />);
    await signIn(user);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("reports the network being down", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<LoginForm />);
    await signIn(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("אין חיבור לשרת");
  });
});
