import { describe, expect, it } from "vitest";

import { loginInputSchema, safeNext } from "@/lib/auth-schema";

describe("loginInputSchema", () => {
  it("accepts a username and password", () => {
    const parsed = loginInputSchema.parse({
      username: "dana",
      password: "s3cret",
    });
    expect(parsed).toEqual({ username: "dana", password: "s3cret" });
  });

  it("trims the username but never the password", () => {
    const parsed = loginInputSchema.parse({
      username: "  dana  ",
      password: "  padded  ",
    });
    expect(parsed.username).toBe("dana");
    // Trailing spaces can be part of a real password; trimming produces a login
    // that fails for no visible reason.
    expect(parsed.password).toBe("  padded  ");
  });

  it.each([
    ["empty username", { username: "", password: "x" }, "username"],
    ["whitespace username", { username: "   ", password: "x" }, "username"],
    ["empty password", { username: "dana", password: "" }, "password"],
    [
      "username over 256 chars",
      { username: "a".repeat(257), password: "x" },
      "username",
    ],
    [
      "password over 512 chars",
      { username: "dana", password: "a".repeat(513) },
      "password",
    ],
  ])("rejects %s", (_label, input, field) => {
    const result = loginInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe(field);
  });

  it("reports errors in Hebrew", () => {
    const result = loginInputSchema.safeParse({ username: "", password: "" });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "צריך שם משתמש",
    );
  });
});

describe("safeNext", () => {
  it.each([
    ["/", "/"],
    ["/search", "/search"],
    ["/search?q=%D7%93%D7%A0%D7%94", "/search?q=%D7%93%D7%A0%D7%94"],
    ["/create#top", "/create#top"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    // The classic form of the bug: passes a naive startsWith("/") check.
    ["protocol-relative", "//evil.com"],
    // Browsers normalise "\" to "/", so this is the same host swap.
    ["backslash-normalised", "/\\evil.com"],
    ["absolute url", "https://evil.com"],
    ["scheme-relative absolute", "//evil.com/path"],
    ["javascript scheme", "javascript:alert(1)"],
    ["bare host", "evil.com"],
    ["empty string", ""],
  ])("rejects %s", (_label, input) => {
    expect(safeNext(input)).toBe("/");
  });

  it.each([[null], [undefined]])("falls back to / for %s", (input) => {
    expect(safeNext(input)).toBe("/");
  });
});
