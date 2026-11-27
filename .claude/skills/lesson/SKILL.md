---
name: lesson
description: Record something learned about this codebase so it is never re-taught — append it to the owning role's lessons.md and, when it is lint-shaped, write the house ESLint rule in the same turn. Use whenever the user corrects a mistake, or a review finds something no rule covers.
argument-hint: "[role] <what was learned>"
---

# Record a lesson

A correction that lives only in this conversation is lost when the session ends. This skill
puts it somewhere that loads next time, and — when a checker can decide it — turns it into
a gate so nobody has to remember it at all.

**Run this whenever the user corrects something**, not only when they ask. A reply that
acknowledges a correction without recording it guarantees the same correction next week.

## 1. Pick the role

From the argument, or inferred from the files involved:

| Role | Owns |
|---|---|
| `security` | sign-in, role permissions, maker-checker, authority limits, DTO validation, error bodies, throttling, secrets, logs |
| `ui-ux` | design tokens, outcome and state clarity, confirmations, error states, Simulated labels, formatPeso, accessibility |
| `data` | entities, migrations, Money and the schedule, idempotency constraints, transactions and locks, decision record, activity history |
| `architecture` | package boundaries, ports and adapters, Nest modules, the lifecycle transition table, placement |
| `qa` | unit, integration and e2e tests, acceptance-criteria traceability |
| `devops` | verify gate, hooks, GitHub Actions, Dockerfiles, pinned images, env parity, secrets |

If it genuinely spans two roles, file it under the one whose reviewer should catch it.

## 2. Check whether it is already known

Do not read whole files. Search both halves of the role's ledger:

```bash
git grep -in -e '<keyword>' -e '<other keyword>' -- '.claude/skills/*-conventions/lessons*.md'
pnpm lessons for <the file the correction was about>
```

- **Found in `lessons-log.md` under a `Gate:` line** — a gate exists and did not fire. The
  lesson is not the problem; the gate is. Say which gate and why it missed (lint not run, or
  a hole in the rule), and add the missed case to that rule's RuleTester file.
- **Found as a line in `lessons.md`** — this is a REPEAT. Prose did not prevent it, so it
  must not stay prose: promote it now (step 4), or, if no checker can decide it, re-tag it
  `shape: judgment` and add `Repeat: <date> — <why no checker can decide this>` under its
  log heading.
- **Not found** — continue.

## 3. Write both halves

Each role has two files under `.claude/skills/<role>-conventions/` (ADR 0016):

**`lessons-log.md`** — never loaded. Add a section at the top of the entries:

```
## <role>-<YYYYMMDD>-<kebab-slug>

<The rule, stated as an instruction>. Why: <the consequence that makes it matter — the bug,
the outage, the silent failure>. <Anything a future reader needs to trust or remove it.>
```

The **Why** is not decoration. A rule without its reason gets deleted by the next person
who finds it inconvenient. It lives here so that it costs nothing until someone asks.

**`lessons.md`** — loaded, one line, newest first, only while no gate enforces it:

```
- [<the same id>] paths: <glob>, <glob> · shape: <shape> · <Instruction>. Check: <what a reviewer looks at>.
```

- `paths:` repo-relative globs, as narrow as the lesson allows. This is what makes the line
  load only for the files it is about. A bare `**` is charged triple against the budget.
- `shape:` `lint-candidate` (one file's AST decides it), `check-candidate` (a script over
  files, manifests or SQL decides it), `test-candidate` (a Jest or Vitest case pins it), or
  `judgment` (only a reviewer can). Candidates are the promotion queue.
- ≤ 320 characters per line, ≤ 8000 bytes per file. `pnpm house:check` fails otherwise. A full
  file is a signal to promote or merge lessons, not to raise the budget.

## 4. If it is lint-shaped, write the rule now

Lint-shaped means a checker can decide it from a file's path and syntax tree: a forbidden
import, a missing wrapper, a banned prop, a required export, a wrong call shape. If the
correction has exactly one right rewrite, give the rule a `fix()`: preflight then applies
the lesson itself, before any reviewer reads the file.

Follow `house-rule-authoring` end to end — rule file in `packages/eslint-house/src/rules/`,
register in `packages/eslint-house/src/index.js` and the root `eslint.config.js`, RuleTester
cases, then:

```bash
pnpm --filter @loan/eslint-house test
pnpm lint
```

Register as `"error"`. The exception is a rule that flags **more than ten** existing sites:
register it as `"warn"`, note `pending promotion (N sites)` in the log entry, and say so —
one lesson must never turn the whole build red.

Then **move the lesson out of the loaded file**: delete its line from `lessons.md` and add
`Gate: house/<rule>` directly under its `## <id>` heading in `lessons-log.md`. The rule's
error message is now the lesson; `pnpm lessons show house/<rule>` gives the why on demand.

No approval step. The user asked for this to be automatic; asking every time is the
behaviour they are trying to get rid of.

## 5. If it is not lint-shaped, say so

Some lessons need runtime, the database, or judgment. Keep them as prose, and tag the
nearest deterministic alternative in `shape:` so it can be picked up later:

- SQL-, JSON-, Dockerfile- or cross-file-shaped → `check-candidate`. When a script can decide
  it now, write `tools/review/src/checks/<id>.ts` (a default-exported `HouseCheck`; the header
  of `tools/review/src/checks/_registry.ts` is the recipe), add its case to
  `tools/review/test/checks.test.ts` (and its id to `EXPECTED_CHECKS` there), run
  `pnpm --filter @loan/review-tools test`, and gate the lesson with `Gate: check:<id>`
- behavioural → `test-candidate`; if you can write the Jest or Vitest case now, do, and treat
  it as the gate (`Gate: test: <path>`) instead of keeping the line
- operational → a runbook step, `judgment`
- visual or experiential → `judgment`; the reviewer is the enforcement

## 6. Report

Run `pnpm lessons check` and get it green. Then say what was written, the rule name if one
was created, and any pre-existing violations the new rule surfaced — those are for the main
session to fix in the same change.
