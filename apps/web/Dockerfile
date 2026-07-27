# syntax=docker/dockerfile:1

FROM node:20.19.0-bookworm-slim AS dependencies

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/auction-commitment/package.json packages/auction-commitment/package.json

RUN npm ci

FROM dependencies AS builder
COPY . .

RUN npm run build --workspace @auction/commitment \
  && npm run build --workspace @auction/web

FROM node:20.19.0-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /workspace/apps/web/.next/standalone ./
COPY --from=builder /workspace/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/system/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/server.js"]
