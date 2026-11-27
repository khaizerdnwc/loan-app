---
name: review
description: Review the current diff with the role reviewers that own the changed files — security, ui-ux, data, architecture, qa, devops — running in parallel and merged into one report. Use before committing or opening a PR.
argument-hint: "[base-ref | --cached] [--bugfix]"
---

# Review

Run the deterministic gates first, then fan the diff out to the role reviewers that own the
changed files, and merge their reports. Nothing a gate can decide reaches a reviewer, and
roles with nothing in scope are not spawned — that is the whole cost control (ADR 0016).

## 1. Preflight — gates before agents

```bash
pnpm review:preflight ${ARGUMENTS}
```

`<spec>` below means the arguments without `--bugfix` (a base ref, `--cached`, or nothing).

It resolves the diff (the argument; else the working tree plus untracked files; else the
staged diff; else `origin/main...HEAD`), applies house-rule autofixes to the changed files
and names each file it rewrote (with `--cached`, re-stage them and run it again), then runs
Biome, ESLint with every house rule, `house:check` (cross-file checks and the lessons
ledgers), the type checker (through turbo, for the changed packages and their dependents) and
the related unit tests of each changed package (Jest or Vitest, whichever it uses) — the API
integration suite too when API, domain or money code changed and `TEST_DATABASE_URL` is set. With `--bugfix` (passed by `/fix-bug`) or on a `fix/` branch it
also runs the **repro proof**: the changed tests must fail without the fix and pass with it.

- **Red** — report the gate output to the user as the review result and **spawn nobody**.
  Fix, then run `/review` again. A reviewer paid to re-find a lint error is waste.
- **Green** — keep its printed summary; it goes into every reviewer prompt.
- **"nothing changed"** — say there is nothing to review and stop.

## 2. Which reviewers, which files, which lessons

```bash
pnpm review:roles <spec>
```

It prints one block per role the diff needs — its files and the lessons it must answer —
from the path table `ROLE_PATHS` in `tools/review/src/_review.ts` (the single source; do not
map paths by hand). A file can belong to several roles; that is intended. A role with no block is not
spawned.

## 3. Spawn them together

Send **one message containing all the Agent calls** so they run in parallel. For each role:

- `subagent_type`: the role name
- prompt, built inline:
  ```
  Run the <role>-review checklist on `git diff <resolved-ref>`. Return only your report.
  Your files: <the role's Files lines>
  Preflight (green): <the preflight summary>
  Lessons you must answer, one line each in your report's `Lessons` section:
  <the role's Lessons lines>
  ```

Always pass the file list, however small the diff: it stops each reviewer re-deriving it.

## 4. Save, check, merge

Save each reviewer's report **verbatim** to `.claude/.review/<role>.report.md`, then:

```bash
pnpm review:ack <spec>
```

It recomputes which lessons each role had to answer and fails on a missing report or an
unanswered lesson id. On a failure, send that reviewer (SendMessage, same agent) the missing
ids, overwrite its saved report with the reply, and run it again. Do not answer for it.

Then one report, grouped by role, in this order: every ❌ first, then every ⚠️, then a
single ✅ line per role that passed. Keep each finding's `file:line`. Do not re-word
findings into agreement — if two roles disagree, show both and say so.

End with any `New rules` sections the reviewers produced: each new house ESLint rule, what
it blocks, and the pre-existing violations it surfaced for you to fix.

## 5. Stamp it

**Stage before you review.** The commit lock evaluates the staged diff, and the Claude hook
does so *before* your command runs, so `git add -A && git commit …` in one call is always
refused. The working order is three separate calls: stage, review + stamp, commit — and
review with `--cached`.

When there are no findings left to fix:

```bash
pnpm review:ack <spec> --stamp
```

It writes `.claude/.review-stamp` only when the last preflight for this exact diff was
green and every lesson was answered. Never write the stamp by hand. The lock that reads it
(`scripts/review-stamp-check.sh`) runs from the Claude hook and from the lefthook
`commit-msg` job, so it applies to every commit (ADR 0017).

## What this skill does not do

It does not apply fixes. The reviewers are read-only on product code by design, and you
hold the user's intent — decide which findings to act on, fix them, and re-run `/review`.
