# WhiteBank Lending MVP — agent guide

The canonical spec for every AI tool working in this repo. `CLAUDE.md` points here.

## 1. What this is

A web MVP that takes a WhiteBank personal loan from application through automated credit
decision, referral review, approval within authority, and booking with disbursement into a
simulated core banking system. Staff-facing only (no borrower app, no mobile). All data is
synthetic; every external service is simulated in this repo. Scope, assumptions and
deferrals: `docs/ACCEPTANCE.md`, `docs/ASSUMPTIONS.md`.

## 2. Non-negotiables

1. **Rules live on the backend.** Roles, maker-checker, authority limits, product limits
   and state transitions are enforced in `packages/base` behind Nest guards and services.
   The UI only mirrors them. Every controller handler declares `@Roles(...)` or `@Public()`.
2. **Money is exact.** `Money` (packages/core, decimal.js) everywhere; `numeric(14,2)`
   columns; decimal strings on the API. Interest and rounding: ADR 0019. Never `number`
   arithmetic on amounts.
3. **Decisions are reproducible.** Pure engine over a stored input snapshot with versioned
   rules; insert-only decision records; `POST /decisions/:id/reproduce` (ADR 0022).
4. **Booking is idempotent.** Key + unique constraints + row lock + idempotent core call;
   failures retry with the same key (ADR 0020).
5. **One transaction per state change**, and every state change writes an activity event
   (who, what, when, before/after) in that same transaction.
6. **External services are ports.** Interfaces in `packages/contracts`; simulated
   implementations only in `apps/api/src/adapters/simulated`, bound only in
   `adapters/simulated/simulated-providers.module.ts` (imported by `app.module.ts`). Each simulator has `ok | outage | timeout | malformed` modes
   and labels its output as simulated.
7. **Outages degrade to referral, never decline** (PRD NFR-005).
8. **No real data, no real providers, no secrets in the repo, no applicant data in logs.**

## 3. Where to edit

| Change | Location |
|---|---|
| Money, shared types, RFC 9457 error shape | `packages/core/src` |
| Port interface for an external service | `packages/contracts/src` |
| Lending domain (one Nest module, `lending.module.ts`: auth, cases, simulation controls) | `packages/base/src/{auth,cases,simulation}/` |
| Case status changes (the transition table) | `packages/base/src/cases/lifecycle.ts` (`moveTo`) |
| Decision engine, rule sets, scorecard | `packages/base/src/decisioning/engine/` |
| Migrations, data source, transaction runner | `packages/base/src/database/` |
| Seed data (personas, staff, product) | `packages/base/src/seed/` |
| Simulated providers | `apps/api/src/adapters/simulated/` |
| API bootstrap, env, composition root | `apps/api/src/` (`main.ts`, `config/env.ts`, `app.module.ts`) |
| API integration tests | `apps/api/test/*.e2e-spec.ts` |
| Backoffice screens | `apps/backoffice/src/app/` |
| Shared UI components and design tokens | `packages/ui/src`, `apps/backoffice/src/app/globals.css` |
| Browser journeys | `apps/backoffice/e2e/` |
| House lint rules | `packages/eslint-house` (follow the `house-rule-authoring` skill) |
| House checks, review tooling | `tools/review/src` |
| Gate stages | `scripts/verify/verify.sh` (ADR 0018, 0021) |

## 4. Working process

1. Read the relevant ADRs and `docs/ACCEPTANCE.md`. Plan before touching auth, money,
   booking, migrations or the gate.
2. Implement. Use the `add-*` skills for new modules, endpoints, contracts, migrations and pages.
3. Every acceptance criterion names a passing test. Docs change in the same commit.
4. `/review` before every commit: `pnpm review:preflight`, then the role reviewers. Fix,
   then `pnpm review:ack --stamp`, then commit. The commit lock refuses an unreviewed diff.
5. A user correction or a repeatable reviewer finding → `/lesson`.
6. Bugs go through `/fix-bug`: reproduce in a failing test and in the browser first.

## 5. Commands (all from the repo root)

```bash
pnpm install && pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev
#   backoffice http://localhost:3100  ·  API http://localhost:3101 (Swagger at /docs)
pnpm typecheck · pnpm lint · pnpm test · pnpm test:integration · pnpm test:e2e
pnpm house:check · pnpm deps:check · pnpm lessons for <files>
pnpm review:preflight [--cached] · pnpm review:roles · pnpm review:ack [--stamp]
pnpm verify [--only security,static,unit,db,integration,build,e2e]
```

## 6. Commits and PRs

Conventional Commits (`feat(booking): …`, `fix(decisioning): …`, `test: …`, `docs: …`).
A `fix:` carries `Repro-Test: <file>` or `Repro: not testable — <reason>`. Work happens on
`build/mvp`; a human merges the pull request. Agents never merge.

## 7. Output requirements

When finishing a task, state: the acceptance criteria and ADRs relied on, the tests added
and their result, anything simulated, and any assumption added to `docs/ASSUMPTIONS.md`.
