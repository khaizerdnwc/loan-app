---
name: architecture-conventions
description: What this repo's architecture is — the apps/ + packages/ layout and its dependency direction, ports and simulated adapters, Nest module boundaries, the composition root and the lifecycle transition table — plus the lint rules and checks that enforce each. Load when adding a module or package, or editing contracts, *.module.ts, adapters, package entry points or manifests.
paths:
  - packages/contracts/**
  - **/*.module.ts
  - apps/api/src/adapters/**
  - packages/*/src/index.ts
  - packages/*/package.json
  - apps/*/package.json
---

# Architecture conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## Layout and direction

```
packages/core       Money, shared types, errors        (depends on nothing in the repo)
packages/contracts  ports for external services        → core
packages/base       domain modules, entities, database → core, contracts
packages/ui         shared React components + tokens   → core (types only)
apps/api            NestJS bootstrap + adapters        → base, contracts, core
apps/backoffice     Next.js staff console              → ui, core (types only)
```

Dependencies point one way: `core ← contracts ← base ← apps`. No cycles; the backoffice never
imports `base` or `contracts` (it talks to the API over HTTP). dependency-cruiser enforces
this (`pnpm deps:check`, part of the `static` stage).

## Ports and adapters

- Each external service — credit bureau, KYC/AML, core banking, e-signature, disbursement —
  is a port in `packages/contracts`: an interface + an injection token + the result types.
- Implementations live only in `apps/api/src/adapters/` (today: `simulated/`). Each simulator
  has the failure modes `ok | outage | timeout | malformed`, labels its output *simulated*, and
  passes the port's conformance test suite.
- `apps/api/src/adapters/simulated/simulated-providers.module.ts` is the only place that binds
  a port token to an implementation; the composition root (`apps/api/src/app.module.ts`)
  imports it. Domain code injects the token and types against the port —
  `house/no-provider-import-outside-adapters`.

## Modules and lifecycle

- The lending domain is **one Nest module** (`packages/base/src/lending.module.ts`) with
  folders `auth/`, `cases/`, `simulation/`, `automation/` and the pure `decisioning/engine/`.
  Every case service works on one aggregate (the loan case) through one repository and one
  transaction runner, so splitting into per-feature modules would only re-export that
  repository. `automation/` (product automation: mode, kill switch, change requests) is a small
  second aggregate kept in the module on purpose: a decision reads it under a share lock inside
  the case's own transaction (docs/ARCHITECTURE.md). Split when an aggregate stands alone (e.g.
  collections). It exports only `SessionGuard`, `JwtModule` and `ExpiryService` (for the API's
  expiry-sweep timer).
- The decision engine is pure (no Nest, no I/O) and versioned, so it can be unit-tested and
  re-run to reproduce a decision.
- The case lifecycle is **one transition table** (`cases/lifecycle.ts`): a status is written
  only by `moveTo(c, event, to)`, which checks both ends of the edge, or `startDraft(c)` —
  `house/no-case-status-assignment-outside-lifecycle`.
- Provider mode (simulated or real) comes from the port or its result, never a literal in
  `packages/base`.

## Enforced by lint and checks

`no-provider-import-outside-adapters`, `no-commented-out-code`, `no-todo-comment`;
`check:root-manifest-no-catalog`, `check:dockerfile-workspace-manifests`; dependency-cruiser.

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role architecture
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).
