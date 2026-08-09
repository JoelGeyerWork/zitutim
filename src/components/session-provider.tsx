"use client";

import { createContext, useContext } from "react";

import type { SessionUser } from "@/lib/auth-schema";

/**
 * The signed-in user, read once per request in the root layout and shared with
 * every client component below it.
 *
 * This is display state, **not** a security boundary. Hiding an edit menu when
 * signed out is UX; the 401 from the API is the enforcement. Never gate
 * anything on this that the server doesn't also check.
 *
 * Defaults to `null` so a component can be rendered without a provider — which
 * keeps the signed-out case testable without a wrapper.
 */
const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionUser | null {
  return useContext(SessionContext);
}
