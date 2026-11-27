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
- The composition root (`apps/api/src/app.module.ts`) is the only place that binds a token to
  an implementation. Domain code injects the token and types against the port —
  `house/no-provider-import-outside-adapters`.

## Modules and lifecycle

- One Nest module per feature in `packages/base/src/<feature>/` (auth, applications,
  decisioning, review, approvals, booking, activity, simulation-control). A module exports
  only what another module needs; nothing reaches into another module's repository.
- The decision engine is pure (no Nest, no I/O) and versioned, so it can be unit-tested and
  re-run to reproduce a decision.
- The case lifecycle is **one transition table**: every state change goes through it, and it
  is the only place that knows which state may follow which, and who may cause it.

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
