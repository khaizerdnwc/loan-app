---
name: qa-conventions
description: What this repo's testing model is — which runner covers which package, the integration suite on real Postgres, the Playwright journeys, and the acceptance-criteria-to-test traceability — plus the lint rules and gates that enforce each. Load when editing tests, e2e specs, docs/ACCEPTANCE.md, or domain behaviour in packages/base.
paths:
  - **/__tests__/**
  - **/*.test.ts
  - **/*.test.tsx
  - **/*.spec.ts
  - **/*.e2e-spec.ts
  - apps/backoffice/e2e/**
  - docs/ACCEPTANCE.md
  - packages/base/src/**
---

# QA conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## Which test where

| Behaviour | Test | Runner |
|---|---|---|
| decision engine, scorecard, rules, bands, reason codes | `packages/base/test/**` | Jest |
| Money, schedule maths and reconciliation | `packages/core/test/**`, simulated core tests | Jest |
| lifecycle transition table | `packages/base/test/**` | Jest |
| simulated providers vs their port | conformance suite per port | Jest |
| role boundaries, maker-checker, authority, validation, duplicate booking, outage, retry | `apps/api/test/*.e2e-spec.ts` (supertest, real Postgres) | Jest (`pnpm test:integration`) |
| forms, formatters, components | `apps/backoffice`, `packages/ui` | Vitest |
| F1 and F2 end to end in the browser | `apps/backoffice/e2e/*.spec.ts` | Playwright |

Integration tests truncate tables between tests: they run only against a database whose name
ends in `_test` (`TEST_DATABASE_URL`), never the dev database.

## The bar

- Every criterion in `docs/ACCEPTANCE.md` names the test that proves it, and that test exists
  and passes.
- A test must **fail without the change** it accompanies. A fix proves it with the repro proof
  (`pnpm review:repro`).
- A success test asserts the outcome — body, status of the case, amounts, the rows written —
  not only `2xx` (`house/no-status-only-assertion`). A refusal test asserts the 4xx **and**
  that nothing changed.
- Duplicate booking is tested both ways: the same request replayed, and two requests at once.
- No skipped or focused tests (Biome `noSkippedTests`, `noFocusedTests`).

## Gates

Pre-push runs unit tests for affected packages; the pull request runs unit, integration (fresh
Postgres) and e2e as separate jobs (ADR 0021).

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role qa
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).
