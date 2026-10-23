# syntax=docker/dockerfile:1
# OGSERC Registration & Evaluation System — production image.
# Targets:
#   runner  the web app (Next.js standalone server), run by deploy/docker-compose.yml as "app"
#   tools   full toolchain for database migrations and the seed, run once per deploy as "migrate"
# See docs/DEPLOYMENT.md.

FROM node:22.14.0-bookworm-slim AS base
# OpenSSL for the Prisma engine; CA certificates for outbound TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies (cached until package files change) ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# --- Build; also the "tools" image for migrations and the seed ---
FROM deps AS tools
COPY . .
# Placeholders for the build only; nothing connects at build time. Real values come from the
# environment at run time.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:1/build" \
    AUTH_SECRET="build-time-placeholder-not-used-at-runtime" \
    npx prisma generate && npm run build

# --- Runtime: the standalone server and only what it needs ---
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=tools --chown=node:node /app/.next/standalone ./
COPY --from=tools --chown=node:node /app/.next/static ./.next/static
COPY --from=tools --chown=node:node /app/public ./public
# Fonts and images for the generated PDFs (read from ./assets at run time).
COPY --from=tools --chown=node:node /app/assets ./assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
