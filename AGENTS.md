<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Standard commands live in `README.md` / `package.json` — use those. Notes below are
only the non-obvious, Cloud-specific bits.

### Services

- **Web app** — Next.js dev server on `http://localhost:3000`, started by the environment
  `start` command (`npm run dev`). Lint/test/build: see the README scripts table.
- **MongoDB** — runs **natively**, not via `docker compose db:up`, because the base VM has
  no Docker daemon running by default. `start` launches `mongod` on `127.0.0.1:27017` with
  its data dir at `$HOME/mongodb-data`, waits for it, then runs `npm run db:seed:demo`
  (a no-op once seeded). If you reinstall Mongo or change the data dir, restart `mongod`
  yourself — the running dev server reconnects automatically.

### Auth / login (`.env.local`)

`install` creates `.env.local` from `.env.example` with a random `SESSION_SECRET`. The
`LDAP_*` block keeps its Active-Directory-shaped defaults, and there is **no domain
controller on this network**, so UI sign-in reports the directory as *unavailable*.
Browsing, search and all public `GET`s work anonymously; only writes need a session.

### Optional: local OpenLDAP for real login / `npm run test:ldap`

Docker is preinstalled and the `osixia/openldap:1.5.0` image is cached in the base
snapshot, but there is **no systemd**, so the daemon is not running at boot. Per session:

1. Start the daemon once (the `ubuntu` user is in the `docker` group):
   `sudo dockerd > /tmp/dockerd.log 2>&1 &` — it uses the `fuse-overlayfs` storage driver
   (kernel here lacks full overlay2 + nftables support; that is already configured in
   `/etc/docker/daemon.json` and via `iptables-legacy`).
2. `npm run ldap:up` (OpenLDAP on `:1636`) then `npm run test:ldap`.
3. To sign in through the UI against it, point the `LDAP_*` block in `.env.local` at the
   container — `LDAP_URL=ldaps://localhost:1636`, `LDAP_BASE_DN=dc=test,dc=local`,
   `LDAP_BIND_DN=cn=admin,dc=test,dc=local`, `LDAP_BIND_PASSWORD=admin-password`,
   `LDAP_TLS_INSECURE=true`, `LDAP_USER_FILTER=(objectClass=inetOrgPerson)`,
   `LDAP_LOGIN_ATTRS=uid,mail`, `LDAP_ID_ATTR=entryUUID` — and restart `npm run dev`.
   Seeded users are in `ldap/bootstrap/01-people.ldif` (e.g. `dana` / `correct-horse`).
