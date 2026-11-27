# ADR 0018 — One verify script

## Status
Accepted (27 Nov 2026). Carried over from nxlvl. Amended by ADR 0021 (where each stage runs).

## Context
When the pre-push hook and CI run different commands, a push that passes locally fails on
the runner, or the other way round, and nobody can say which list is the real gate.

## Decision
- **R1.** `scripts/verify/verify.sh` defines every gate stage once: `security`, `static`,
  `unit`, `db`, `integration`, `build`, `e2e`. The pre-push hook and every GitHub Actions
  job call it with `--only <stages>`; neither adds checks of its own.
- **R2.** Scanners and services run from images pinned by digest
  (`scripts/verify/env.sh`), so the version is the same on every machine.
- **R3.** Every app variable is blanked and then set explicitly in `env.sh`, so nothing
  leaks in from a developer's `.env` files.
- **R4.** Throwaway services use their own ports and `_test` database names, so a verify
  run can happen while the dev stack is up and can never touch the dev database.

## Consequences
One place to add a check. Cost: Docker is needed for the security, database and e2e stages.
