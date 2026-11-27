# ADR 0017 — Closing the soft gates

## Status
Accepted (27 Nov 2026). Carried over from nxlvl.

## Context
A review that is only an instruction runs when someone remembers it. A bug fix whose test
was written after the fix may pass whether or not it reproduces the bug.

## Decision
- **R1. No review, no commit.** `pnpm review:ack --stamp` writes `.claude/.review-stamp`
  (the hash of the staged diff, `git diff --cached | git hash-object --stdin`) only when the
  last preflight for that exact diff was green and every reviewer answered every lesson it
  was given. `scripts/review-stamp-check.sh` refuses a commit of product code whose staged
  diff does not match. It is called by a Claude `PreToolUse` hook and by lefthook
  `commit-msg`, so it applies to every commit. Visible escape hatch: `SKIP_REVIEW=1`.
- **R2. Every lesson answered.** Each reviewer's report must give `applies` or
  `not relevant` for every lesson id `pnpm review:roles` listed; `review:ack` checks it.
- **R3. Bug fixes prove their test.** A `fix:` commit carries `Repro-Test: <file>` (or
  `Repro: not testable — <reason>`). `pnpm review:repro` applies the test in a throwaway
  worktree at the base commit and requires it to fail without the fix and pass with it.
- **R4. Hooks find node.** Every hook sources `scripts/lefthook-rc.sh`, which puts node and
  pnpm on PATH and stops corepack from prompting.

## Still soft
`SKIP_REVIEW=1` and `Repro: not testable` are deliberate, visible opt-outs. A reviewer can
answer a lesson wrongly. Branch protection with required checks is not available on this
private repository's plan, so "green before merge" is a convention.
