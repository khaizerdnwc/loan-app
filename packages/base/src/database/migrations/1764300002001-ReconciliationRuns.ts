import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Reconciliation runs (PRD BKG-005): each run of lending's booking records against core
 * banking's account feed and the payment rail's feed, with its summary and findings.
 * Insert-only (the refuse_change() trigger from 1764300000002). A new table: nothing
 * existing is altered.
 */
export class ReconciliationRuns1764300002001 implements MigrationInterface {
  name = "ReconciliationRuns1764300002001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "reconciliation_run" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "run_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "run_by" character varying(40) NOT NULL,
      "provider_mode" character varying(20) NOT NULL,
      "summary" jsonb NOT NULL,
      "findings" jsonb NOT NULL,
      CONSTRAINT "PK_reconciliation_run_id" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_reconciliation_run_run_at" ON "reconciliation_run" ("run_at")`,
    );
    await q.query(`CREATE TRIGGER reconciliation_run_insert_only BEFORE UPDATE OR DELETE ON reconciliation_run
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DROP TRIGGER reconciliation_run_insert_only ON reconciliation_run");
    await q.query(`DROP INDEX "public"."IDX_reconciliation_run_run_at"`);
    await q.query(`DROP TABLE "reconciliation_run"`);
  }
}
