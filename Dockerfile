# syntax=docker/dockerfile:1
# One image definition, two targets (host-neutral; see docs/DEPLOY.md):
#   docker build --target api -t loan-api .   → NestJS API on :3101 (migrates + seeds on start)
#   docker build --target web -t loan-web .   → Next.js backoffice on :3100 (proxies /api to API_URL)
# Node is pinned by digest (devops conventions); pnpm comes from package.json via corepack.

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Every workspace manifest, so the frozen install sees every importer and the layer caches
# (check:dockerfile-workspace-manifests).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/backoffice/package.json apps/backoffice/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/base/package.json packages/base/
COPY packages/ui/package.json packages/ui/
COPY packages/eslint-house/package.json packages/eslint-house/
COPY tools/review/package.json tools/review/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@loan/api... --filter=@loan/backoffice...

FROM base AS api
ENV NODE_ENV=production PORT=3101
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3101
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Migrations then the idempotent synthetic seed, then the API (one process per container).
CMD ["sh", "-c", "node dist/cli/db.js migrate && node dist/cli/db.js seed && exec node dist/main.js"]

FROM base AS web
ENV NODE_ENV=production PORT=3100
COPY --from=build /app /app
WORKDIR /app/apps/backoffice
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/sign-in').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "exec node_modules/.bin/next start -p ${PORT} -H 0.0.0.0"]
