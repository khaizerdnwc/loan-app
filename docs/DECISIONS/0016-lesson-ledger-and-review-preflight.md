# ADR 0016 — Lesson ledger and review preflight

## Status
Accepted (27 Nov 2026). Carried over from nxlvl; amends ADR 0015.

## Context
Prose lessons grow without bound and get loaded whether they apply or not. Reviewer agents
that re-find what a linter finds are paid to run a linter.

## Decision
- **R1. Two files per role** under `.claude/skills/<role>-conventions/`:
  `lessons.md` (loaded: one path-tagged line per ungated lesson,
  `- [<role>-YYYYMMDD-slug] paths: <globs> · shape: <shape> · <instruction>`) and
  `lessons-log.md` (never loaded: the full story under `## <id>`, with `Gate: …` once a
  machine enforces it).
- **R2. Budget.** Each `lessons.md` is at most 8,000 bytes, a lesson on `**` counts three
  times, a line is at most 320 characters, and a gated lesson must leave `lessons.md`.
  Enforced by `pnpm house:check` (`checkLedgers` in `tools/review/src/_lessons.ts`).
- **R3. Lessons reach the editor deterministically.** `.claude/hooks/lessons-before-edit.sh`
  shows a file's lessons before its first edit in a session; `pnpm lessons for <files>`
  shows them on demand.
- **R4. Deterministic gates run before any reviewer.** `pnpm review:preflight` runs house
  autofixes, Biome, ESLint, `house:check`, typecheck (changed packages and their
  dependents), related tests per package (Jest or Vitest), the integration suite when a
  test database is configured, and the repro proof for bug fixes. Red means no agent is
  spawned. The result is written to `.claude/.review/preflight.json`.
- **R5. Lint on save.** `.claude/hooks/lint-on-edit.sh` runs the root ESLint config on each
  file Claude writes and hands errors straight back.

## Consequences
Reviewer tokens go to judgment, not lint. The ledger stays small enough to load. Cost:
ledger grammar to follow; `house:check` fails on a malformed line.
