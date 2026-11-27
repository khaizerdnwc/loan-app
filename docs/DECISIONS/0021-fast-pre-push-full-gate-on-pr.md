# ADR 0021 — Fast pre-push, full gate on the pull request

## Status
Accepted (27 Nov 2026). Amends ADR 0018, which ran the whole gate on every push.

## Context
In nxlvl the full gate on pre-push took 20–25 minutes. This build runs as a continuous
loop with a push after every milestone; a 20-minute pause per push would cost hours over
the weekend and tempt `--no-verify`.

## Decision
- **R1. Pre-push = fast gate.** `scripts/verify/pre-push.sh` runs
  `verify.sh --only static,unit --affected <base>`: house checks, dependency rules,
  typecheck, Biome, ESLint and unit tests for the packages changed since the remote's copy
  of the branch (or the merge base with `origin/main` for a new branch), plus the packages
  that depend on them. No Docker. Target: under two minutes.
- **R2. Pull request = full gate, in parallel.** `.github/workflows/verify.yml` runs one job
  per stage group: `security`, `static`, `unit`, `db + integration`, `build + e2e`. The wall
  clock is the slowest job.
- **R3. A draft PR is opened as soon as the branch exists**, so the full gate runs on every
  push during the build, not only at the end. The build loop reads `gh pr checks` and fixes
  a red job before starting the next milestone.
- **R4. Shared config outside any package** (`tools/jest/**`, `tsconfig.base.json`) is in
  turbo's `globalDependencies`, so changing it invalidates every cached result and counts
  every package as affected.
- **R5. `pnpm verify` still runs everything locally** on demand: before submission, and
  whenever GitHub Actions is unavailable.

## Consequences
Pushes are fast. A push can reach the PR with a failing integration or e2e test; the PR job
catches it minutes later instead of the laptop catching it first. Accepted, because R3
keeps that window to one milestone. Reconsider if a broken main ever results.

Note: `deps:check` passes only the top-level folders that exist (`$(ls -d apps packages
tools)`), because dependency-cruiser fails on a missing path; this matters only before apps/
exists, and is harmless after.
