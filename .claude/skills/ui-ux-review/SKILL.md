---
name: ui-ux-review
description: Review a diff for token discipline, outcome and state clarity, confirmation of consequential actions, error, loading and empty states, simulated labels, money formatting and accessibility on the backoffice. Use before a PR, or whenever a change touches backoffice .tsx/.css or packages/ui.
argument-hint: "[base-ref]"
context: fork
agent: ui-ux
background: false
---

# UI and UX review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `ui-ux-conventions`). If nothing
is left, report `ui-ux-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role ui-ux`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### Tokens
- No colour, radius or font literal in a component; a new visual value becomes a token.

### Clarity
- Outcome and stage use the shared pill and wording; reason codes are shown in words; the
  referral trigger is visible on referred cases; pending states name the next actor.
- Simulated results are labelled *Simulated*.

### Actions
- Every consequential action has a confirmation dialog that names amount, tenor and effect.
- Buttons a role cannot use are hidden or disabled with a visible reason — and the server
  still refuses (that is security's check; flag a UI-only gate here too).

### Errors and states
- Problem details are shown readably and inline; no raw JSON or status codes.
- Every fetching screen has loading, empty and error states.

### Money and accessibility
- Amounts go through `formatPeso()`; tables right-align them.
- Inputs have labels; dialogs trap focus and close on Escape; focus is visible; contrast holds
  on the tokens.

## Quick scans

```bash
grep -rn "#[0-9a-fA-F]\{6\}\|rgb(" apps/backoffice/src packages/ui/src --include=*.tsx
grep -rn "window\.confirm\|alert(" apps/backoffice/src --include=*.tsx
pnpm lint
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
ui-ux-review: ✅ | ⚠️ | ❌

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
