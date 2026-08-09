/**
 * Config the auth modules need before anything touches them. Every one of them
 * reads `process.env` lazily (see the comment on `secret()` in session.ts), so
 * setting these at setup time — after imports — is enough.
 *
 * Not a `beforeAll`: `vi.mock` factories and module-scope code in a test file
 * can run first, and a missing SESSION_SECRET throws rather than degrading.
 */
process.env.SESSION_SECRET ??= "test-secret-that-is-at-least-32-characters";
process.env.SESSION_TTL_HOURS ??= "8";

process.env.LDAP_URL ??= "ldaps://dc.test.local:636";
process.env.LDAP_BASE_DN ??= "OU=Users,DC=test,DC=local";
process.env.LDAP_BIND_DN ??= "CN=svc,OU=Service Accounts,DC=test,DC=local";
process.env.LDAP_BIND_PASSWORD ??= "service-account-password";

// The login route holds every failure open to a fixed floor so a nonexistent
// username can't be told from a wrong password by timing. Real value, no
// waiting: the one test that cares stubs it back up.
process.env.LOGIN_MIN_RESPONSE_MS ??= "0";
