---
name: qa-review
description: Review a diff for test coverage of changed behaviour, acceptance-criteria traceability, tests that would fail without the change, integration coverage of permissions and booking safety, and test stability. Use before a PR, or whenever a change touches tests, e2e, docs/ACCEPTANCE.md or domain behaviour.
argument-hint: "[base-ref]"
context: fork
agent: qa
background: false
---

# QA review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `qa-conventions`). If nothing
is left, report `qa-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role qa`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### Coverage of what changed
- Every changed behaviour has a test at the lowest level that can show it, and the test would
  fail if the change were reverted (read the assertion, not the name).
- Every criterion touched in `docs/ACCEPTANCE.md` names a test that exists and passes.

### The required cases (challenge §6b, deliverable 1.iv)
- Rule outcomes: approve, refer and decline, each knockout, each referral trigger, the band
  edges (599/600, 699/700) and the F1 (742 A) and F2 (612 C) personas.
- Out-of-limit amount and tenor, and an incomplete application: 400 with a readable problem.
- Unauthorized actions per endpoint: each wrong role gets 403, called directly on the API.
- Maker-checker: the maker cannot check; the recommender cannot approve their override.
- Authority: an approver above their amount or grade gets 403 and the case escalates.
- Duplicate booking: sequential replay and two concurrent requests → one account, one
  disbursement. Failed booking → retry with the same key succeeds without a duplicate.
- Bureau outage → referred with the outage reason code, never declined.

### Quality
- Success tests assert the body and the database, not only the status.
- Refusal tests assert nothing changed.
- No sleeps or order dependence; integration tests isolate their data; e2e uses seeded personas.

## Quick scans

```bash
pnpm --filter @loan/api run test:integration -- --listTests
grep -rn "\.skip\|\.only\|xit(\|fit(" apps packages --include=*.ts --include=*.tsx | grep -v node_modules
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
qa-review: ✅ | ⚠️ | ❌

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
