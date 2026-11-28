import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Referential integrity on the child tables, and TRUNCATE refused on the insert-only ones.
 *
 * Foreign keys (ON DELETE / ON UPDATE NO ACTION: nothing cascades into the history), each
 * declared on its entity too so the drift check stays clean:
 * - decision_record, activity_event, booking_request, loan_account → loan_case
 * - loan_account → booking_request; schedule_line, disbursement → loan_account
 * - loan_case.decision_id → decision_record (the case's current decision)
 * - consent_record, aml_escalation → applicant
 * - provider_call.case_id → loan_case (nullable: a call outside a case has none)
 * Not keyed: actor and staff columns (they hold "SYSTEM" for the engine and the sweeps, and
 * history keeps a removed staff member's id; reconciliation_run.run_by is one), audit_event
 * (the tamper-evident log stands on its own and records the case reference as text),
 * bureau_report_cache (a copy of the bureau's data, replaced on each pull), and the
 * simulators' `sim` schema (an external system's own store).
 *
 * TRUNCATE: the row-level refuse_change() triggers (1764300000002, …) cannot see a TRUNCATE,
 * which empties a table without touching a row. A statement-level BEFORE TRUNCATE trigger on
 * each insert-only table refuses it, as audit_event already does (1764300002000). The API's
 * test harness disables these, as the table owner and inside one transaction, around its reset.
 *
 * An existing database with an orphan row fails here naming the constraint; docs/DEPLOY.md
 * has the pre-flight query.
 */
const FOREIGN_KEYS = [
  ["decision_record", "FK_decision_record_case", "case_id", "loan_case"],
  ["activity_event", "FK_activity_event_case", "case_id", "loan_case"],
  ["booking_request", "FK_booking_request_case", "case_id", "loan_case"],
  ["loan_account", "FK_loan_account_case", "case_id", "loan_case"],
  ["loan_account", "FK_loan_account_booking_request", "booking_request_id", "booking_request"],
  ["schedule_line", "FK_schedule_line_loan_account", "loan_account_id", "loan_account"],
  ["disbursement", "FK_disbursement_loan_account", "loan_account_id", "loan_account"],
  ["loan_case", "FK_loan_case_decision", "decision_id", "decision_record"],
  ["consent_record", "FK_consent_record_applicant", "applicant_id", "applicant"],
  ["aml_escalation", "FK_aml_escalation_applicant", "applicant_id", "applicant"],
  ["provider_call", "FK_provider_call_case", "case_id", "loan_case"],
] as const;

/**
 * Every insert-only table without a guard yet (audit_event has its own, 1764300002000). Listed,
 * not read from the catalogue, so down() drops exactly what up() made; the integration test
 * (integrity.e2e-spec.ts) checks the catalogue so a later insert-only table cannot miss one.
 */
const INSERT_ONLY = [
  "decision_record",
  "activity_event",
  "consent_record",
  "automation_event",
  "reconciliation_run",
  "provider_call",
];

export class ForeignKeysAndTruncateGuards1764300009000 implements MigrationInterface {
  name = "ForeignKeysAndTruncateGuards1764300009000";

  async up(q: QueryRunner): Promise<void> {
    for (const [table, name, column, parent] of FOREIGN_KEYS) {
      await q.query(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}")
        REFERENCES "${parent}"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
    for (const table of INSERT_ONLY) {
      await q.query(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON "${table}"
        FOR EACH STATEMENT EXECUTE FUNCTION refuse_change()`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const table of [...INSERT_ONLY].reverse()) {
      await q.query(`DROP TRIGGER ${table}_no_truncate ON "${table}"`);
    }
    for (const [table, name] of [...FOREIGN_KEYS].reverse()) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
    }
  }
}
