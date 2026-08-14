/**
 * A deployment-configuration fault — an unset or malformed environment
 * variable — as distinct from anything the caller typed or the directory said.
 *
 * It exists to be *distinguishable*. Every config fault used to reach the user
 * as `unavailable` → 503 "לא הצלחנו להתחבר לשרת ההזדהות", which sends whoever
 * investigates to the domain controller: the one place nothing is wrong. An
 * unset `SESSION_SECRET` is the sharpest version — it throws only *after* the
 * directory has successfully authenticated the person now being told the
 * directory is unreachable.
 *
 * Nothing recovers from one; the point is that the message names the right
 * problem, and that `instrumentation.ts` can surface it at boot instead of
 * leaving it for the first person who tries to sign in.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
