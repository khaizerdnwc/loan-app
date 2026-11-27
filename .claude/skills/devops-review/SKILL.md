---
name: devops-review
description: Review a diff for gate-stage drift between verify.sh, hooks and workflows, pinning of images and actions, Dockerfile correctness, environment parity and secrets hygiene. Use before a PR, or whenever a change touches CI, verify scripts, hooks, Dockerfiles, compose files, workspace manifests or env examples.
argument-hint: "[base-ref]"
context: fork
agent: devops
background: false
---

# DevOps review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `devops-conventions`). If nothing
is left, report `devops-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role devops`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### One gate
- A new check is added to `verify.sh` first; the workflow and hook only call stages.
- Pre-push stays fast: nothing Docker-based or whole-repo in `static,unit --affected`.
- Each PR job maps to exactly one stage, and every stage has a job.

### Pinning and images
- New images pinned by digest, new actions by commit SHA, with the version in a comment.
- Dockerfiles: every workspace manifest copied before a frozen install; multi-stage; non-root;
  no dev dependencies or `.env` in the final image; a health check route exists.

### Environment and secrets
- Every new env key is in the schema, `.env.example` and `verify/env.sh` (blanked or set).
- No secret committed; test values are obviously dummy.
- Ports and database names in scripts never collide with the dev stack.

## Quick scans

```bash
grep -rn "uses: [^@]*@v[0-9]" .github/workflows
grep -rn "image: \|FROM " --include=Dockerfile --include=*.yml . | grep -v "@sha256" | grep -v node_modules
pnpm house:check
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
devops-review: ✅ | ⚠️ | ❌

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
