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

`npm run ldap:up` needs Docker, which the base VM does **not** have running. This is a
nested VM (no systemd; the kernel lacks full overlay2 + nftables support), so Docker needs
the `fuse-overlayfs` storage driver and legacy iptables. Set it up on demand:

1. Install Docker once (idempotent). Follow the "Docker in Cloud Agent VM" recipe: install
   `docker-ce`/`docker-compose-plugin` + `fuse-overlayfs`, write
   `/etc/docker/daemon.json` with `{"storage-driver":"fuse-overlayfs"}`, and
   `update-alternatives --set iptables /usr/sbin/iptables-legacy` (same for `ip6tables`).
   Then `sudo usermod -aG docker ubuntu`.
2. Start the daemon (no systemd): `sudo dockerd > /tmp/dockerd.log 2>&1 &`. If the socket
   isn't group-readable yet in this shell, `sudo chmod 666 /var/run/docker.sock`.
3. `npm run ldap:up` (OpenLDAP on `:1636`) then `npm run test:ldap`.
4. To sign in through the UI against it, point the `LDAP_*` block in `.env.local` at the
   container — `LDAP_URL=ldaps://localhost:1636`, `LDAP_BASE_DN=dc=test,dc=local`,
   `LDAP_BIND_DN=cn=admin,dc=test,dc=local`, `LDAP_BIND_PASSWORD=admin-password`,
   `LDAP_TLS_INSECURE=true`, `LDAP_USER_FILTER=(objectClass=inetOrgPerson)`,
   `LDAP_LOGIN_ATTRS=uid,mail`, `LDAP_ID_ATTR=entryUUID`,
   `LDAP_SEARCH_MODE=substring` — and restart `npm run dev`. That last one is not
   optional against this container: the default is `anr`, which is Active
   Directory's and which OpenLDAP does not implement, so the directory search
   would come back empty for every query rather than reporting an error.
   Seeded users are in `ldap/bootstrap/01-people.ldif` (e.g. `dana` / `correct-horse`).
