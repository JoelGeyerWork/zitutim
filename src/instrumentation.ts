/**
 * Checks the auth and mail configuration once, at boot.
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

  const [
    { assertSessionConfigured },
    { assertLdapConfigured },
    { assertMailConfigured },
  ] = await Promise.all([
    import("@/lib/session"),
    import("@/lib/ldap"),
    import("@/lib/mail"),
  ]);

  const collect = (checks: (() => void)[]): string[] => {
    const problems: string[] = [];
    for (const check of checks) {
      try {
        check();
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    return problems;
  };

  // Every problem is reported, not just the first: they are all set from one
  // file, so whoever is fixing this wants the whole list in one pass.
  const authProblems = collect([assertSessionConfigured, assertLdapConfigured]);
  if (authProblems.length > 0) {
    console.error(
      [
        "",
        "  Sign-in is not configured. Browsing works; adding, editing and",
        "  deleting will not, and nothing else will say why until someone tries.",
        "",
        ...authProblems.map((problem) => `  - ${problem}`),
        "",
      ].join("\n"),
    );
  }

  // Kept separate, and a warning rather than an error, because the blast radius
  // is different: unconfigured mail costs only the share button, while the rest
  // of the wall — reading and writing alike — works exactly as it should.
  const mailProblems = collect([assertMailConfigured]);
  if (mailProblems.length > 0) {
    console.warn(
      [
        "",
        "  Outgoing mail is not configured. Everything else works; sharing a",
        "  quote by email will answer 500 until these are set.",
        "",
        ...mailProblems.map((problem) => `  - ${problem}`),
        "",
      ].join("\n"),
    );
  }
}
