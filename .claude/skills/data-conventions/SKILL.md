---
name: data-conventions
description: What this repo's data rules are — Money and NUMERIC(14,2), the schedule rounding rule and its reconciliation, idempotent booking (unique constraints, row lock, same-key retry), one transaction per state change with its activity event, the insert-only decision record, migrations only, and the simulator's separate schema — plus the lint rules that enforce each. Load when editing entities, migrations, repositories, the database module, seeds or Money.
paths:
  - **/entities/**
  - **/*.entity.ts
  - **/migrations/**
  - **/*.repository.ts
  - packages/base/src/database/**
  - packages/base/src/seed/**
  - packages/core/src/money/**
  - packages/base/src/decisioning/**
---

# Data conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## Money

- Every amount is a `Money` from `@loan/core` (decimal.js underneath). Never a JS number —
  `house/no-float-money` flags arithmetic, `parseFloat`/`Number`/unary `+` and `.toFixed()` on
  money-named values, and float/real/double/money columns.
- Columns: `numeric(14,2)` with the Money transformer. The API carries amounts as decimal
  **strings**. Rates are decimals too (monthly add-on rate by grade), stored with their scale.
- **Rounding rule** (the simulated core owns it; lending stores what core returns):
  interest = principal × monthly rate × tenor, rounded half-up to the centavo; each
  instalment = (principal + interest) ÷ n rounded **down** to the centavo; the **final
  instalment absorbs the remainder**; the principal/interest split per instalment follows
  the same rule. Booking is refused unless Σ instalments = principal + interest exactly.

## Consistency

- **One transaction per state change**, and the activity event for it is written in that same
  transaction (who, what, when, from-state, to-state). A state change without its event is a
  bug. Services run units of work through `TransactionRunner` (packages/base/src/database);
  raw DataSource/EntityManager/`.query()` live only in repositories and the database module
  (`house/no-datasource-outside-repository`).
- **Booking** commits booking + loan account + schedule + disbursement + case status +
  activity together or not at all.
- **Idempotency**: an idempotency key is created at submit. Unique constraints on
  `booking.application_id`, `loan_account.application_id`, `disbursement.loan_account_id` and
  both idempotency keys. The checker's approval takes a row lock on the application
  (`FOR UPDATE`) and re-checks the state inside the transaction. A retry reuses the same key.
- **Decision record** — insert-only: inputs snapshot (JSONB) + its hash, rule-set and
  scorecard versions, per-rule results, score, grade, outcome, reason codes, referral trigger,
  provider mode. Never updated; a new decision is a new row. Reproduce re-runs the stored
  inputs against the stored versions.
- **Simulator state** (the simulated core's accounts, the bureau's responses) lives in its own
  schema (`sim_core`, …) and commits in its own transaction — never inside the lending
  transaction — so "account created but the reply was lost" is a real, testable case.

## Schema changes

Migrations only (`house/no-typeorm-synchronize`). Generate, read, then commit the migration;
the PR's `db` job applies every migration from empty and fails on entity/migration drift.
Limited queries carry an order (`house/require-order-with-take`). Seeds are idempotent: the
`db` job runs them twice.

## Enforced by lint and gates

`no-float-money`, `no-datasource-outside-repository`, `no-typeorm-synchronize`,
`require-order-with-take`; the `db` stage of `pnpm verify` (migrations from empty, drift,
seed twice). The canonical rule list is the header of
[`packages/eslint-house/src/index.js`](../../../packages/eslint-house/src/index.js).

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role data
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).
