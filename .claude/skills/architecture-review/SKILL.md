---
name: architecture-review
description: Review a diff for package boundaries and dependency direction, port and adapter discipline, Nest module wiring, the lifecycle transition table and code placement. Use before a PR, or whenever a change adds a module or package, or touches contracts, *.module.ts, adapters or package manifests.
argument-hint: "[base-ref]"
context: fork
agent: architecture
background: false
---

# Architecture review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `architecture-conventions`). If nothing
is left, report `architecture-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role architecture`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### Boundaries
- Imports follow `core ← contracts ← base ← apps`; the backoffice imports only `ui` and `core`
  types. A new cross-package import is justified or moved.
- New code sits where `AGENTS.md` "Where to edit" says. A helper used by one module stays in it.

### Ports and adapters
- A new external interaction is a port in `packages/contracts` first, then a simulated adapter
  with all four failure modes, a *simulated* label, and the port's conformance test.
- Domain code depends on the token and the port type only; the binding is in `app.module.ts`.
- Swapping the simulator for a real provider would not change a line in `packages/base`.

### Modules and lifecycle
- Module exports are minimal; no module imports another's repository or entity directly.
- Every state change goes through the transition table; no service sets `status` by hand.
- The decision engine stays pure and versioned; a scoring or rule change bumps its version.

### Simplicity
- No abstraction without a second user; no framework for one case. "Appropriate simplicity"
  is scored.

## Quick scans

```bash
pnpm deps:check
grep -rn "adapters/\|simulated" packages/base/src --include=*.ts
grep -rn "\.status *=" packages/base/src --include=*.ts
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
architecture-review: ✅ | ⚠️ | ❌

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
