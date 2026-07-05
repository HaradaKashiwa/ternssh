# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
COPY server/package.json server/package-lock.json ./server/
COPY package.json package-lock.json ./

RUN npm ci --prefix web && npm ci --prefix server

COPY web/ ./web/
COPY wrangler.jsonc ./

RUN npm run build --prefix web

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
  PORT=8787 \
  CI=1 \
  WRANGLER_SEND_METRICS=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g wrangler@4.24.3

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev

COPY wrangler.jsonc ./
COPY server/ ./server/
COPY docker/entrypoint.sh /entrypoint.sh
COPY --from=builder /app/server/public ./server/public

RUN chmod +x /entrypoint.sh \
  && mkdir -p /app/.wrangler

VOLUME ["/app/.wrangler"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
