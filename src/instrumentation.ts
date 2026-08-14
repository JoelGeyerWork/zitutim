/**
 * Checks the auth configuration once, at boot.
 *
 * Without this, an unset `SESSION_SECRET` or `LDAP_*` variable stays invisible
 * until the first person tries to sign in — the container starts, reports
 * healthy, and serves the feed and search perfectly, because the public read
 * path verifies no token and talks to no directory. That is the worst shape a
 * misconfiguration can take: everything looks right, and the one thing that is
 * broken is the thing nobody exercises for a day.
 *
 * It **logs and keeps going** rather than throwing. Throwing here does not stop
 * the process the way it looks like it should: Next reports "Failed to prepare
 * server" and then serves 500 for *every* route while still holding the port,
 * so a mistake in the login configuration would take the whole wall down —
 * including the reading, which is most of what it is for. Reading stays up;
 * writing is what a bad `LDAP_*` breaks, and the login route now says so
 * plainly (`misconfigured` → 500, distinct from the directory being down).
 */
export async function register() {
  // Guards against a future edge-runtime entry point: node:fs and ldapts are
  // not available there, and this check has nothing to say about it anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ assertSessionConfigured }, { assertLdapConfigured }] =
    await Promise.all([import("@/lib/session"), import("@/lib/ldap")]);

  const problems: string[] = [];

  for (const check of [assertSessionConfigured, assertLdapConfigured]) {
    try {
      check();
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (problems.length === 0) return;

  // Both are reported, not just the first: they are set from one file, so
  // whoever is fixing this wants the whole list in one pass.
  console.error(
    [
      "",
      "  Sign-in is not configured. Browsing works; adding, editing and",
      "  deleting will not, and nothing else will say why until someone tries.",
      "",
      ...problems.map((problem) => `  - ${problem}`),
      "",
    ].join("\n"),
  );
}
