# ADR 0022 — Reproducible, insert-only decision records

## Status
Accepted (27 Nov 2026).

## Context
Credit Risk needs every decision to be consistent, explainable and reproducible: the same
inputs and the same rule version must give the same outcome, later, on demand. The PRD:
"Every path ends in an immutable decision record: inputs, rule version, model version,
outcome."

## Alternatives considered
1. **Store only the outcome and re-derive the rest from current data.** Not reproducible:
   applicant data, bureau data and rules all change.
2. **Event-sourced engine.** More than a weekend MVP needs.
3. **A pure engine over a stored input snapshot, with versioned rules.** Chosen.

## Decision
- **R1. The engine is a pure function** (packages/base/src/decisioning/engine):
  `decide(inputs, ruleSetVersion) → result`. No clock, no database, no randomness, no I/O.
- **R2. Inputs are gathered first**, through the ports (application, applicant, KYC/AML,
  bureau), into one `DecisionInputs` snapshot.
- **R3. The decision record is insert-only:** inputs snapshot (JSONB), its SHA-256 hash,
  rule set version, scorecard version, per-rule results, score, grade, outcome, reason codes,
  referral trigger, provider mode (`SIMULATED`), created at. The repository exposes no
  update or delete, and a database trigger rejects UPDATE and DELETE.
- **R4. Versions are code.** Rule sets and scorecards are versioned constants; a change is a
  new version, and old versions stay so old records can be replayed.
- **R5. Reproduce on demand.** `POST /decisions/:id/reproduce` re-runs the stored inputs
  against the stored versions and reports `match` or the differing fields.
- **R6. Human decisions are separate records** (recommendation, approval, override with
  reason code), linked to the automated decision, never edits of it.

## Consequences
Any decision can be explained and replayed in the demo. Cost: rule versions are kept forever
in code. Reconsider when rules move into a configurable rules editor (PRD LND-DEC-001), at
which point rule sets would be stored as published, immutable data.
