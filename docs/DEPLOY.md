# Deploying

Host-neutral: one `Dockerfile` with two targets, plus a managed or containerised Postgres 16.
No provider-specific files. The challenge's dev environment is not yet named
(`docs/BUILD-STATUS.md`, M10).

## Images

```bash
docker build --target api -t loan-api .   # NestJS API, port 3101
docker build --target web -t loan-web .   # Next.js backoffice, port 3100
```

On start, the API applies pending migrations, runs the idempotent synthetic seed, then serves.
Each step is safe to repeat on restart. The migration runner takes no cross-process lock, so
start one API replica first and scale out after it is healthy (a single replica is enough for
the demo). Both images report health (`HEALTHCHECK`: API `/health`, backoffice `/sign-in`).

Known limit: the final images carry the whole build stage, devDependencies included, rather
than a pruned production install (`pnpm deploy --prod`). That makes them larger, with no
effect on behaviour. Pruning is the next image change.

## Configuration

| Service | Variable | Value |
|---|---|---|
| api | `DATABASE_URL` | `postgres://…` (the lending database) |
| api | `JWT_SECRET` | 32+ random characters (`openssl rand -hex 32`); the example value is refused |
| api | `CORS_ORIGIN` | the backoffice's public URL |
| api | `NODE_ENV` | `production` (the image sets it): the session cookie is then `Secure`, so serve over HTTPS |
| api | `TRUST_PROXY_HOPS` | `0` unless an appending load balancer sits in front of the API |
| web | `API_URL` | the API's internal URL, e.g. `http://api:3101` (required in production) |

Only the backoffice needs to be public. The browser talks only to the backoffice's `/api`
proxy, so the API can stay on a private network. Swagger at `/docs` is then reachable only
inside it.

## Rehearse locally

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
# backoffice http://localhost:8100 · API http://localhost:8101/health
```

Rehearsed by hand on 27 Nov 2026 (not a gate stage): migrations applied (3), the seed ran,
`/health` returned ok, and `/sign-in` and `/api/auth/personas` were served through the
backoffice proxy. The gate's e2e stage covers the same path from built sources.

## Checks after deploying

1. `GET <api>/health` → `{"status":"ok"}`.
2. Sign in as each persona and run F1 (Maria) and F2 (Joel) as in `docs/ACCEPTANCE.md`.
3. As Leo, switch a simulator to OUTAGE and back. A non-OK mode resets itself after 15
   minutes, so a reviewer cannot leave the demo broken.

## Rollback

Redeploy the previous image tags. The migrations only add (no destructive `down` is run on
deploy), so the previous API runs against the newer schema.
