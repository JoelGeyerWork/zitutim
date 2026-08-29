import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = {
  // Honours the "@/*" paths from tsconfig.json.
  tsconfigPaths: true,
  alias: {
    // `server-only` throws unless it is loaded under Next's react-server
    // condition. Outside Next it exists purely as a marker, so stub it out.
    "server-only": fileURLToPath(
      new URL("./tests/setup/server-only-stub.ts", import.meta.url),
    ),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        // Pure functions, the Mongo data layer, and the route handlers.
        resolve,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/server/**/*.test.ts"],
          setupFiles: ["tests/setup/env.ts", "tests/setup/mongo.ts"],
          // One in-memory Mongo per worker; serialise so files can't collide.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Integration tests against the OpenLDAP container from
        // docker-compose.ldap.yml. Excluded from `npm test` on purpose — the
        // rest of the suite needs no Docker — so run it with `npm run test:ldap`
        // after `npm run ldap:up`.
        resolve,
        test: {
          name: "ldap",
          environment: "node",
          include: ["tests/ldap/**/*.test.ts"],
          setupFiles: ["tests/setup/env.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        // Integration tests against the Mailpit sink from
        // docker-compose.mail.yml. Excluded from `npm test` for the same reason
        // the ldap project is — no Docker for the default suite — so run it
        // with `npm run test:mail` after `npm run mail:up`.
        resolve,
        test: {
          name: "mail",
          environment: "node",
          include: ["tests/mail/**/*.test.ts"],
          setupFiles: ["tests/setup/env.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
      {
        // React components against jsdom.
        resolve,
        test: {
          name: "ui",
          environment: "jsdom",
          // A real origin, so localStorage is available rather than throwing
          // the way it does on jsdom's default opaque origin.
          environmentOptions: { jsdom: { url: "http://localhost:3000/" } },
          include: ["tests/ui/**/*.test.tsx"],
          setupFiles: ["tests/setup/dom.ts"],
          globals: true,
        },
      },
    ],
  },
});
