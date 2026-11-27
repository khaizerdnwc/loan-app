---
name: data-review
description: Review a diff for money representation and rounding, schedule reconciliation, idempotency constraints, transaction and locking correctness, decision-record immutability, activity history, migrations and seed data. Use before a PR, or whenever a change touches entities, migrations, repositories, the database module, seeds or Money.
argument-hint: "[base-ref]"
context: fork
agent: data
background: false
---

# Data review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `data-conventions`). If nothing
is left, report `data-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role data`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### Money and the schedule
- No number arithmetic on money anywhere the lint does not reach (template strings, JSON
  round-trips, `as number` casts). Money crosses the API as strings.
- The schedule follows the documented rounding rule exactly, and a test asserts
  Σ instalments = principal + interest (and Σ principal parts = principal) across a grid of
  amounts, tenors and grades — not one example.
- Booking refuses a schedule that does not reconcile.

### Transactions, locks, idempotency
- Each state change and its activity event commit in one transaction; nothing is written
  after the commit that the response depends on.
- Booking writes booking, account, schedule, disbursement, status and activity in one
  transaction; a failure leaves none of them.
- The unique constraints that make duplicates impossible exist **in a migration**, not only on
  the entity. The checker path locks the application row and re-reads its state inside the
  transaction; two concurrent approvals produce one account and one 409/no-op.
- A retry after a lost reply reuses the idempotency key and returns the existing account.

### Records
- The decision record is insert-only: no update/save on an existing row, no cascade that can
  rewrite it. It stores the inputs snapshot and every version needed to reproduce it.
- Activity events record who (user id + role), what, when, from-state and to-state.
- Simulator state is in its own schema and its own transaction.

### Schema and queries
- Every entity change has a generated migration; `synchronize` stays off.
- Money columns are `numeric(14,2)`; foreign keys and the indexes queues filter on exist.
- Limited queries are ordered; seeds are idempotent and synthetic only.

## Quick scans

```bash
grep -rn "synchronize\|type: *['\"]\(float\|real\|double\)" packages apps --include=*.ts | grep -v node_modules
grep -rln "\.save(\|\.update(" packages/base/src --include=*.ts | xargs grep -ln "DecisionRecord" 2>/dev/null
grep -rn "Unique\|unique: true" packages/base/src --include=*.ts
```

## Every finding

1. **Already covered by a house rule or check?** Report it as `REPEAT (house/<rule>)` or
   `REPEAT (check:<id>)` and say why the gate did not stop it — usually the lint step was not
   run, occasionally the rule has a hole worth widening.
2. **Not covered, and lint-shaped?** Write the rule now, following `house-rule-authoring`
   (read `.claude/skills/house-rule-authoring/SKILL.md` first): rule file, register in
   `packages/eslint-house/src/index.js` + the root `eslint.config.js`, RuleTester cases, then
   `pnpm --filter @loan/eslint-house test` and `pnpm lint`. List it under a `New rules`
   heading with any pre-existing violations it found.
3. **Not lint-shaped?** Add it as a lesson — a narrative section in `lessons-log.md` and one
   path-tagged line in `lessons.md`, per the `/lesson` skill's grammar — with the nearest
   deterministic alternative as its `shape:`. Run `pnpm lessons check`.

## Output

```
data-review: ✅ | ⚠️ | ❌

❌ <file>:<line> — <what is wrong>. <why it matters here>. <the fix>
⚠️ <file>:<line> — <what to check>. <why>
✅ <one line per check that passed and was non-trivial>

Lessons
- [<id>] applies — checked: <what you looked at, and what you found>
- [<id>] not relevant — <why this lesson does not touch these files' change>

New rules
- house/<name> — <what it now blocks>. <N pre-existing violations, listed>
```

**Answer every lesson id you were given** in the `Lessons` section, one line each, even
when it does not apply — `pnpm review:ack` refuses the review stamp while any id is
unanswered (ADR 0017). A lesson that applies and is violated is also a ❌ or ⚠️ above.

Severest first. Cite `file:line`. **Do not apply fixes to product code** — the main
session does that. You may write lint rules, house checks, your `lessons.md` /
`lessons-log.md`, and your own notes.
