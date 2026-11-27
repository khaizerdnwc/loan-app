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
  referral trigger, provider mode (the bureau port's own mode), created at. The repository
  exposes no update or delete, and a database trigger rejects UPDATE and DELETE. TRUNCATE is
  not blocked: the integration tests use it to reset, and only the database owner can run it.
  A production database would revoke TRUNCATE from the application role.
- **R2a. The decision is made on the draft that was read.** Inputs are gathered before the
  lock; inside it, submit refuses (409) if the case's version changed meanwhile.
- **R4. Versions are code.** Rule sets and scorecards are versioned constants; a change is a
  new version, and old versions stay so old records can be replayed.
- **R5. Reproduce on demand.** `POST /decisions/:id/reproduce` re-runs the stored inputs
  against the stored versions and reports `match` or the differing fields.
- **R6. Human decisions never edit the automated record.** The current recommendation,
  approval or approver decline is held on the case (what the next step acts on), and every
  one is also an insert-only activity event carrying its terms (type, amount, tenor, rate,
  override reason, rationale). A return followed by a new recommendation replaces the
  case's columns; the history stays in the events. The `approved_by` column holds the
  approver who last acted (approve, decline or return), which keeps the case in their view.

## Consequences
Any decision can be explained and replayed in the demo. Cost: rule versions are kept forever
in code. Reconsider when rules move into a configurable rules editor (PRD LND-DEC-001), at
which point rule sets would be stored as published, immutable data.

## Amendment — automation mode and RS-PL-2 (28 Nov 2026)

- **The automation mode is an input.** The product's mode (off, shadow, live) and kill switch
  are read in the decision's own transaction, under a share lock on the product's automation
  row (a change takes the update lock), and added to the snapshot as `inputs.automation`, so
  the hash covers them and a replay applies them. The engine always runs the rules and the
  score; unless the mode is live with the switch off, the outcome becomes REFER and the
  engine's own outcome is kept. The record gains `automation_mode`, `kill_switch` and
  `engine_outcome` (PRD §7.5, AIS-007).
- **The overlay is versioned.** It runs only for rule sets with `automationModes` (RS-PL-2):
  such a rule set refuses a snapshot without the mode, and RS-PL-1 refuses one with it. Twelve
  RS-PL-2 decisions are frozen in a fixture (D-15), like the ten RS-PL-1 ones (D-14), and a
  database CHECK refuses a record after RS-PL-1 without its engine outcome.
- **Rollback is forward-only for RS-PL-2 records.** Code from before this amendment has no
  RS-PL-2 and cannot replay them; roll forward instead of back once RS-PL-2 decisions exist.
  The migration's down() drops the mode columns of RS-PL-2 records too, and migrating up over
  such records is then refused by the CHECK (rehearsed): the revert is for databases with no
  RS-PL-2 decisions.
- **Records from before the amendment** have no `inputs.automation`: the engine leaves them
  untouched, and the migration backfills their columns as LIVE and off without rewriting a row
  (a column default, then dropped). `engine_outcome` stays null on them and reads as `outcome`.
  Reproduce also checks that the mode columns agree with the snapshot.
- **New triggers are a new version (R4).** RS-PL-2 adds the income-mismatch, related-party and
  fraud triggers through optional rule-set fields; RS-PL-1 has none of them and still replays
  every record made under it (ACCEPTANCE D-14, TR-2). A rule set refuses a snapshot that lacks
  an input it needs, instead of guessing it.
