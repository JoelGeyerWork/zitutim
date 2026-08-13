/**
 * Generates the self-signed certificate the local OpenLDAP container serves
 * LDAPS with, into .ldap/certs/ (gitignored).
 *
 *   node scripts/ldap-certs.mjs
 *
 * This is not a workaround for certificate checking — it is the same shape as
 * production, where the DC presents a certificate from an internal CA and
 * LDAP_TLS_CA points at that CA. There is deliberately no way to skip
 * verification, so local development needs a certificate that actually
 * verifies. Self-signed means the certificate is its own CA, hence ca.pem
 * being a copy of cert.pem.
 *
 * Re-running is a no-op unless --force is passed.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".ldap", "certs");
const cert = join(dir, "cert.pem");
const key = join(dir, "key.pem");
const ca = join(dir, "ca.pem");

if (existsSync(cert) && !process.argv.includes("--force")) {
  console.log(`Certificate already exists at ${cert} — pass --force to replace.`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

// CN and SAN are localhost because that is the name the app connects to; a
// mismatch here fails hostname verification even when the CA is trusted.
try {
  execFileSync(
    "openssl",
    [
      "req", "-x509",
      "-newkey", "rsa:2048",
      "-nodes",
      "-keyout", key,
      "-out", cert,
      "-days", "365",
      "-subj", "/CN=localhost",
      // ::1 as well as 127.0.0.1: "localhost" resolves to the IPv6 loopback
    // first on macOS, and a certificate without it fails verification there
    // while passing everywhere else.
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ],
    // openssl narrates key generation on stderr; only worth seeing if it fails.
    { stdio: ["ignore", "ignore", "pipe"] },
  );
} catch (error) {
  console.error(String(error.stderr ?? error.message));
  process.exit(1);
}

copyFileSync(cert, ca);

// slapd runs as its own user inside the container and has to read the key off
// the bind mount. This is a throwaway key for a local container; it never
// leaves the machine and is regenerated freely.
chmodSync(key, 0o644);

console.log(`Wrote cert.pem, key.pem and ca.pem to ${dir}`);
