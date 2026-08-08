# syntax=docker/dockerfile:1

# Builds the Next.js app into a standalone server (see `output: "standalone"`
# in next.config.ts) so the runtime stage carries no node_modules of its own.

FROM node:22-alpine AS base
# next-swc and the Tailwind/lightningcss native binaries want glibc symbols
# that musl only provides through this shim.
RUN apk add --no-cache libc6-compat


FROM base AS deps
WORKDIR /app
# npm ci installs devDependencies (the build needs them), which would otherwise
# fire mongodb-memory-server's postinstall and pull a MongoDB tarball off
# fastdl.mongodb.org — only the test suite uses it, and there is no musl build.
ENV MONGOMS_DISABLE_POSTINSTALL=1
# Only the manifests, so a source-only change reuses this layer's install.
COPY package.json package-lock.json ./
RUN npm ci


FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No MONGODB_URI here on purpose: every page that reads the database is
# `force-dynamic`, so the build never opens a connection.
RUN npm run build


FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# The standalone bundle ships its own minimal server.js plus the traced subset
# of node_modules; static assets are not copied into it by the build.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
