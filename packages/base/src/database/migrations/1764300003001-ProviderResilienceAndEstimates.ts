import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Provider resilience and cost (PRD IH-003, IH-005, IH-006) and decision estimates (AIS-001,
 * NFR-003).
 *
 * - `provider_call`: every decision provider attempt (and every call answered from the bureau
 *   cache or refused by an open circuit), with its simulated cost. Insert-only (the
 *   refuse_change() trigger, 1764300000002). No applicant data.
 * - `bureau_report_cache`: the last bureau report per applicant and provider mode, reused for
 *   30 days. Keyed on the mode too, so a simulated report never feeds a decision recorded
 *   under another provider mode.
 * - Indexes for the 30-day windows: `provider_call (created_at, service)` and
 *   `decision_record (created_at)`.
 * - `decision_record` gains `pd`, `recommended_amount` and `latency_ms`, all nullable: records
 *   from before RS-PL-3 / SC-PL-2 have no estimate, and no record before this one was timed.
 *   Adding nullable columns rewrites no row, so the insert-only trigger does not fire.
 */
export class ProviderResilienceAndEstimates1764300003001 implements MigrationInterface {
  name = "ProviderResilienceAndEstimates1764300003001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "provider_call" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "service" character varying(30) NOT NULL,
      "operation" character varying(30) NOT NULL,
      "outcome" character varying(20) NOT NULL,
      "failure" character varying(10),
      "attempt" integer NOT NULL,
      "duration_ms" integer NOT NULL,
      "cost" numeric(14,2) NOT NULL,
      "case_id" uuid,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_provider_call_id" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_provider_call_created_service" ON "provider_call" ("created_at", "service")`,
    );
    await q.query(`CREATE TRIGGER provider_call_insert_only BEFORE UPDATE OR DELETE ON provider_call
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);

    await q.query(`CREATE TABLE "bureau_report_cache" (
      "applicant_id" character varying(40) NOT NULL,
      "mode" character varying(12) NOT NULL,
      "report" jsonb NOT NULL,
      "retrieved_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_bureau_report_cache_applicant_mode" PRIMARY KEY ("applicant_id", "mode"))`);

    await q.query(`ALTER TABLE "decision_record" ADD "pd" character varying(10)`);
    await q.query(`ALTER TABLE "decision_record" ADD "recommended_amount" numeric(14,2)`);
    await q.query(`ALTER TABLE "decision_record" ADD "latency_ms" integer`);
    await q.query(`CREATE INDEX "IDX_decision_record_created" ON "decision_record" ("created_at")`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_decision_record_created"`);
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "latency_ms"`);
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "recommended_amount"`);
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "pd"`);
    await q.query(`DROP TABLE "bureau_report_cache"`);
    await q.query("DROP TRIGGER provider_call_insert_only ON provider_call");
    await q.query(`DROP INDEX "IDX_provider_call_created_service"`);
    await q.query(`DROP TABLE "provider_call"`);
  }
}
