---
name: devops-conventions
description: What this repo's delivery model is — verify.sh as the single stage definition, the fast pre-push gate, the parallel PR jobs, pinned images and actions, Dockerfiles, env parity and secrets — plus the checks and scanners that enforce each. Load when editing CI workflows, verify scripts, hooks, Dockerfiles, compose files, workspace manifests or env examples.
paths:
  - .github/**
  - **/Dockerfile
  - docker-compose*.yml
  - turbo.json
  - pnpm-workspace.yaml
  - package.json
  - scripts/verify/**
  - lefthook.yml
  - apps/backoffice/next.config.ts
  - **/.env.example
---

# DevOps conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## One gate, defined once (ADR 0018, ADR 0021)

- `scripts/verify/verify.sh` defines every stage: security, static, unit, db, integration,
  build, e2e. The pre-push hook, the PR workflow and `pnpm verify` all call it; never add a
  check to the workflow or the hook without adding it there.
- **Pre-push** runs `--only static,unit --affected <base>`: packages changed since the branch
  was last pushed (plus dependents). No Docker, under two minutes.
- **Pull request** runs each stage as its own parallel job. Branch protection with required
  checks is not available on the free private repo, so "green before merge" is a convention.
- Scanners and services run from images pinned by digest (`scripts/verify/env.sh`); actions
  are pinned by commit SHA.

## Images and environment

- Each app has a Dockerfile that copies every workspace `package.json` before
  `pnpm install --frozen-lockfile` (`check:dockerfile-workspace-manifests`), builds once, and
  runs as a non-root user. hadolint runs in the security stage; actionlint checks workflows.
- Every key an app's `src/config/env.ts` reads is in its `.env.example`
  (`check:env-example-parity`). `env.sh` blanks every app variable before setting test values,
  so a developer's local env never leaks into a gate.
- Root `package.json` uses no `catalog:` specifiers (`check:root-manifest-no-catalog`).
- No secret in the repo: gitleaks over the full history in the security stage, staged scan at
  commit when installed.

## Local stack

Dev Postgres on 5436 (`pnpm db:up`), API on 3101, backoffice on 3100; verify's throwaway
Postgres on 55432 with databases ending in `_test`. Several worktrees can verify at once by
setting `VERIFY_PG_PORT`, `VERIFY_API_PORT` and `VERIFY_WEB_PORT`; the container is named
`loan-verify-<VERIFY_PG_PORT>` (or `VERIFY_CONTAINER_PREFIX`), so runs never remove each other's.

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role devops
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).
