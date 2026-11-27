---
name: add-contract
description: Add or change an external-service port the replaceable way — the port in packages/contracts, a simulated adapter with outage/timeout/malformed modes and a Simulated label, a conformance test any provider must pass, and wiring only in app.module.ts. Use for any interaction with the credit bureau, KYC/AML, core banking, e-signature, disbursement, or a new external service.
argument-hint: "<service, e.g. core-banking: createLoanAccount>"
disable-model-invocation: true
---

# Add a contract (port + simulated adapter)

**STOP.** Engineering Standard 9: each simulated service sits behind its own interface "so a
real provider could replace it later without changes to your workflow or decision logic",
and can be made to fail. Write the port before the simulator.

## Rules

1. **The port** lives in `packages/contracts/src/<service>.port.ts`: an interface, an injection
   token (`export const CORE_BANKING = Symbol("CoreBanking")`), and the request/result types.
   Results are discriminated unions (`{ kind: "ok", … } | { kind: "unavailable" } | …`), so a
   caller must handle failure — an outage is data, not an exception the caller forgets.
2. Money crosses the port as `Money`; results carry `providerMode: "simulated"` so the decision
   record, the UI and the audit trail can label them.
3. **The simulator** lives in `apps/api/src/adapters/simulated/<service>.ts` and implements the
   port exactly. Deterministic per persona (synthetic data only). Failure modes
   `ok | outage | timeout | malformed`, read from simulation-control per call, overridable per
   instance in tests. Stateful simulators (core banking) keep state in their own schema and
   commit in their own transaction.
4. **Idempotent writes**: a write that can be retried (create account, disburse) takes an
   idempotency key and returns the same result for a replayed key.
5. **Wiring** only in `apps/api/src/app.module.ts`:
   `{ provide: CORE_BANKING, useClass: SimulatedCoreBanking }`. Domain code injects the token
   (`house/no-provider-import-outside-adapters`).
6. **Conformance test**: `packages/contracts/test/<service>.conformance.ts` exports a suite
   taking a provider factory; the simulator's test runs it. A real provider would run the
   same suite before it could be enabled.

## Template

```ts
// packages/contracts/src/credit-bureau.port.ts
export const CREDIT_BUREAU = Symbol("CreditBureau");
export type BureauResult =
  | { kind: "ok"; report: BureauReport; providerMode: ProviderMode }
  | { kind: "unavailable"; reason: "outage" | "timeout" | "malformed"; providerMode: ProviderMode };
export interface CreditBureau {
  pull(applicant: BureauSubject): Promise<BureauResult>;
}
```

## Checklist

- [ ] Port, token and types in `packages/contracts`; failures are typed results.
- [ ] Simulator implements the port, deterministic, all four modes, labelled simulated.
- [ ] Retried writes are idempotent by key.
- [ ] Bound only in `app.module.ts`.
- [ ] Conformance suite written and run against the simulator.
- [ ] The domain handles every failure kind safely (bureau unavailable → refer, never decline;
      core timeout → booking failed + safe retry), with an integration test each.
- [ ] `/review` — architecture owns this.
