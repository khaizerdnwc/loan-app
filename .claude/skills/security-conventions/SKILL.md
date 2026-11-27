---
name: security-conventions
description: What this repo's security model is — demo sign-in, the global auth and roles guards, maker-checker, the approver's authority limit, DTO validation, RFC 9457 errors, throttling, env and logging — plus the lint rules that enforce each. Load when editing auth, controllers, guards, decorators, DTOs, the API bootstrap or config, or the backoffice's API client, session or middleware.
paths:
  - packages/base/src/auth/**
  - **/*.guard.ts
  - **/*.controller.ts
  - **/*.decorator.ts
  - **/dto/**
  - apps/api/src/main.ts
  - apps/api/src/config/**
  - apps/backoffice/src/lib/{api,auth,session}*/**
  - apps/backoffice/src/lib/{api,auth,session}*.ts
  - apps/backoffice/src/middleware.ts
---

# Security conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## The walls

1. **Sign-in** — a demo persona picker (`POST /auth/demo-login`) issues a signed JWT in an
   **httpOnly, SameSite=Lax** cookie. No password exists; the picker is labelled as demo
   access and is a documented limitation. The token carries the user id and role only; the
   server re-reads the user (role, authority limit, grades) from the database per request.
2. **Authentication guard** — global. Every route needs a valid session unless it is
   decorated `@Public()` (health, demo sign-in).
3. **Roles guard** — global and **fail closed**: a handler with no `@Roles(...)` and no
   `@Public()` answers 403. `house/require-roles-on-controller-handler` makes the declaration
   visible on every handler.
4. **Domain checks in the service** — role is necessary, not sufficient. Inside the service,
   in the same transaction as the state change:
   - **Maker-checker**: the user who recommended an override cannot approve it; the user who
     submitted a booking cannot check it. Compare user ids, not roles.
   - **Authority limit**: an approver acts only when `amount ≤ authorityLimit` **and** the
     grade is in their allowed grades. Otherwise 403 with the reason, and the case is marked
     escalated for an approver with enough authority.
   - **State**: the action is legal from the case's current state (one transition table).
5. **The browser is untrusted.** The backoffice hides buttons a role cannot use, but that is
   cosmetic. Every check above holds when the API is called directly.

## Input and output

- Every body is a class-validator DTO; the global `ValidationPipe` runs with
  `whitelist: true, forbidNonWhitelisted: true, transform: true`. Money arrives as a decimal
  **string**, validated by pattern, never a number.
- Errors are RFC 9457 problem details (`type`, `title`, `status`, `detail`, `code`). No stack
  traces, SQL, entity names or internal ids beyond the case reference.
- `@nestjs/throttler` on sign-in and on mutating endpoints.

## Secrets, env, logs

- `process.env` only in `apps/<app>/src/config/env.ts` (Zod, validated at boot) —
  `house/no-process-env-outside-config`. New keys go in the schema and `.env.example`
  (`check:env-example-parity`).
- Server code logs through Nest's `Logger` (`house/no-console-in-server`) and **never logs
  applicant data**: names, birthdates, incomes, government ids, request bodies.
- Ids, keys and tokens come from a CSPRNG (`house/no-math-random-in-server`).

## Enforced by lint and scanners

House rules: `require-roles-on-controller-handler`, `no-process-env-outside-config`,
`no-console-in-server`, `no-math-random-in-server`, `no-dangerous-html-without-sanitize`,
`no-error-name-branching`. Plus `eslint-plugin-security`, Semgrep (`p/typescript`,
`p/nodejs`, `p/nextjs`, `p/owasp-top-ten`, `p/secrets`, `p/jwt`), gitleaks, `pnpm audit` +
audit-ci and the licence allowlist — the `security` stage of `pnpm verify`. The canonical
rule list is the header of [`packages/eslint-house/src/index.js`](../../../packages/eslint-house/src/index.js).

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role security
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).
