---
name: security-review
description: Review a diff for authentication, role permissions, maker-checker, authority limits, input validation, error bodies, throttling, secrets and logging problems. Use before a PR, or whenever a change touches auth, controllers, guards, DTOs, the API bootstrap or config, or the backoffice's API client and session.
argument-hint: "[base-ref]"
context: fork
agent: security
background: false
---

# Security review

## Scope the diff

```bash
git diff --name-only ${ARGUMENTS:-HEAD}      # falls back to --cached, then origin/main...HEAD
```

Keep only the files this role owns (see the `paths:` in `security-conventions`). If nothing
is left, report `security-review: ✅ nothing in this role's area` and stop.

The lessons for your files and the preflight gate results are in your prompt when `/review`
spawned you; otherwise run `pnpm lessons for <your files> --role security`. Read those **before**
the diff. A rule that preflight ran green on these files needs no manual re-check.
Then read the changed files in full — a diff hunk hides the context that decides most of
these checks — and open the modules they call into so you check against what those
actually export, not what you assume.

## Checks

### Authentication and session
- Every new route is behind the global auth guard; `@Public()` only on health and demo sign-in.
- The session cookie stays httpOnly, SameSite=Lax, `secure` outside local; the JWT secret comes
  from config, never a literal.
- The server re-reads the user's role and authority from the database; nothing permission-like
  is trusted from the token payload or the request body.

### Role permissions (backend, not the UI)
- Every handler declares `@Roles(...)` for exactly the roles in the permission table — loan
  officer creates and recommends, approver decides, loan operations submits bookings, the
  supervisor checks them, compliance reads, admin drives simulation controls only.
- List and detail endpoints filter by role and stage: a user cannot read or act on a case
  outside their role, including by guessing an id.
- A loan officer cannot approve; an approver cannot book; nobody but the simulation admin can
  flip a failure mode. Each refusal has an integration test calling the API directly.

### Maker-checker and authority
- Override approval and booking check compare **user ids** (maker ≠ checker), inside the
  service, in the same transaction as the state change — not in the controller, not in the UI.
- The authority check uses amount **and** grade, reads the limit from the approver's record,
  and compares Money, not numbers. Above authority → 403 with a readable reason + escalation.
- An override (recommendation differing from the automated outcome or terms) is refused
  without a reason code and rationale.

### Input and output
- Bodies are DTOs; unknown fields are rejected; money is a validated decimal string; ids are
  validated as UUIDs before use.
- Errors are RFC 9457 with a stable `code`; nothing internal leaks (stack, SQL, entity names).
- No `dangerouslySetInnerHTML` without `sanitizeHtml`.

### Throttling, secrets, logs
- Sign-in and mutating endpoints are throttled.
- No new `process.env` outside `src/config/env.ts`; new keys in `.env.example`.
- No secret committed. No applicant data or request bodies in logs.

## Quick scans

```bash
grep -rn "process\.env" apps packages --include=*.ts --include=*.tsx | grep -v "/config/env.ts" | grep -v node_modules
grep -rn "@Public()" apps packages --include=*.ts | grep -v node_modules
grep -rn "logger\.\(log\|debug\|warn\|error\)(.*\(body\|applicant\|income\|birth\)" apps packages --include=*.ts
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
security-review: ✅ | ⚠️ | ❌

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
