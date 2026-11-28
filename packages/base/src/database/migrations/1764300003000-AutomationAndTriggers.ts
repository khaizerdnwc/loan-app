import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-product automation and the kill switch (PRD §7.5), and the inputs for the RS-PL-2
 * referral triggers (income mismatch, related party, fraud; PRD DEC-006, CMP-006).
 *
 * - `product_automation`: one row per product. PL starts LIVE, which is how every decision
 *   ran before this migration, so behaviour does not change until two administrators change it.
 * - `automation_change`: drafts for maker-checker, at most one PENDING per product.
 * - `automation_event`: the insert-only history (the refuse_change() trigger, 1764300000002),
 *   linked to the change request it records.
 * - `decision_record` gains the mode it ran under. Existing records ran live: the columns are
 *   added with a default (a catalogue change in Postgres; no row is rewritten and the
 *   insert-only trigger does not fire), and the default is then dropped so every new record
 *   states its own mode. `engine_outcome` stays null on existing records (it equals `outcome`);
 *   a CHECK allows that only for RS-PL-1 records.
 * - `applicant` gains the declared income and the related-party flag.
 * - `sim.persona_profile` gains the simulated fraud check's answer (null: no signals).
 */
export class AutomationAndTriggers1764300003000 implements MigrationInterface {
  name = "AutomationAndTriggers1764300003000";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "product_automation" (
      "product_code" character varying(10) NOT NULL,
      "mode" character varying(10) NOT NULL,
      "kill_switch" boolean NOT NULL DEFAULT false,
      "kill_switch_set_by" character varying(40),
      "kill_switch_set_at" TIMESTAMP WITH TIME ZONE,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_product_automation_product_code" PRIMARY KEY ("product_code"))`);
    await q.query(
      `INSERT INTO "product_automation" ("product_code", "mode") VALUES ('PL', 'LIVE')`,
    );

    await q.query(`CREATE TABLE "automation_change" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "product_code" character varying(10) NOT NULL,
      "kind" character varying(20) NOT NULL,
      "requested_mode" character varying(10),
      "from_mode" character varying(10) NOT NULL,
      "reason" text NOT NULL,
      "status" character varying(10) NOT NULL,
      "requested_by" character varying(40) NOT NULL,
      "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "decided_by" character varying(40),
      "decided_at" TIMESTAMP WITH TIME ZONE,
      "decision_note" text,
      CONSTRAINT "PK_automation_change_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_automation_change_product" FOREIGN KEY ("product_code")
        REFERENCES "product_automation"("product_code") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_automation_change_pending_per_product" ON "automation_change" ("product_code") WHERE "status" = 'PENDING'`,
    );

    await q.query(`CREATE TABLE "automation_event" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "product_code" character varying(10) NOT NULL,
      "change_id" uuid,
      "action" character varying(40) NOT NULL,
      "actor_id" character varying(40) NOT NULL,
      "actor_name" character varying(120) NOT NULL,
      "actor_role" character varying(40) NOT NULL,
      "summary" text NOT NULL,
      "details" jsonb NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_automation_event_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_automation_event_change" FOREIGN KEY ("change_id")
        REFERENCES "automation_change"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT "FK_automation_event_product" FOREIGN KEY ("product_code")
        REFERENCES "product_automation"("product_code") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
    await q.query(
      `CREATE INDEX "IDX_automation_event_product_created" ON "automation_event" ("product_code", "created_at")`,
    );
    await q.query(`CREATE TRIGGER automation_event_insert_only BEFORE UPDATE OR DELETE ON automation_event
      FOR EACH ROW EXECUTE FUNCTION refuse_change()`);

    await q.query(
      `ALTER TABLE "decision_record" ADD "automation_mode" character varying(10) NOT NULL DEFAULT 'LIVE'`,
    );
    await q.query(`ALTER TABLE "decision_record" ALTER COLUMN "automation_mode" DROP DEFAULT`);
    await q.query(`ALTER TABLE "decision_record" ADD "kill_switch" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "decision_record" ALTER COLUMN "kill_switch" DROP DEFAULT`);
    await q.query(`ALTER TABLE "decision_record" ADD "engine_outcome" character varying(20)`);
    // Only records from before this migration (RS-PL-1) may lack the engine's outcome; reproduce
    // reads a missing one as `outcome`, so a new record without it must be refused here.
    await q.query(
      `ALTER TABLE "decision_record" ADD CONSTRAINT "CHK_decision_record_engine_outcome" CHECK ("engine_outcome" IS NOT NULL OR "rule_set_version" = 'RS-PL-1')`,
    );

    await q.query(`ALTER TABLE "applicant" ADD "declared_monthly_income" numeric(14,2)`);
    await q.query(`ALTER TABLE "applicant" ADD "related_party" boolean NOT NULL DEFAULT false`);

    await q.query("ALTER TABLE sim.persona_profile ADD fraud jsonb");
  }

  async down(q: QueryRunner): Promise<void> {
    // Forward-only once used (ADR 0022 amendment): reverting would drop the mode and engine
    // outcome of RS-PL-2+ records (which then fail the CHECK on the way back up) and the
    // automation history. Refuse instead of losing them. The applicant columns this drops
    // (declared income, related party) and the simulated fraud profiles are restored by the seed.
    const [{ records, events }] = (await q.query(
      `SELECT (SELECT count(*)::int FROM "decision_record" WHERE "rule_set_version" <> 'RS-PL-1') AS records,
              (SELECT count(*)::int FROM "automation_event") AS events`,
    )) as [{ records: number; events: number }];
    if (records > 0 || events > 0) {
      throw new Error(
        `Cannot revert AutomationAndTriggers: ${records} decision record(s) made after RS-PL-1 and ${events} automation event(s) would lose data. Reset the demo database instead.`,
      );
    }
    await q.query("ALTER TABLE sim.persona_profile DROP COLUMN fraud");
    await q.query(`ALTER TABLE "applicant" DROP COLUMN "related_party"`);
    await q.query(`ALTER TABLE "applicant" DROP COLUMN "declared_monthly_income"`);
    await q.query(
      `ALTER TABLE "decision_record" DROP CONSTRAINT "CHK_decision_record_engine_outcome"`,
    );
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "engine_outcome"`);
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "kill_switch"`);
    await q.query(`ALTER TABLE "decision_record" DROP COLUMN "automation_mode"`);
    await q.query("DROP TRIGGER automation_event_insert_only ON automation_event");
    await q.query(`DROP INDEX "IDX_automation_event_product_created"`);
    await q.query(`DROP TABLE "automation_event"`);
    await q.query(`DROP INDEX "UQ_automation_change_pending_per_product"`);
    await q.query(`DROP TABLE "automation_change"`);
    await q.query(`DROP TABLE "product_automation"`);
  }
}
