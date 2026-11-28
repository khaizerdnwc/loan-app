import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The external decision engine option (PRD DEC-008).
 *
 * - `product_automation.external_engine`: NONE, ALONGSIDE or INSTEAD. Every product starts at
 *   NONE, which is how every decision ran before this migration.
 * - `automation_change` gains the role a SET_EXTERNAL_ENGINE change asks for and the role when
 *   it was drafted (maker-checker, like a mode change). Existing changes were drafted under
 *   NONE: the column is added with that default (no row is rewritten), then the default is
 *   dropped so every new change states its own. Existing changes are SET_MODE or
 *   KILL_SWITCH_OFF with no requested role, so the new CHECK holds for them.
 *
 * The engine's answer is stored in the decision record's input snapshot (RS-PL-4), not in a
 * column: no decision_record change.
 */
export class ExternalDecisionEngine1764300003002 implements MigrationInterface {
  name = "ExternalDecisionEngine1764300003002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "product_automation" ADD "external_engine" character varying(10) NOT NULL DEFAULT 'NONE'`,
    );
    await q.query(
      `ALTER TABLE "product_automation" ADD CONSTRAINT "CHK_product_automation_external_engine" CHECK ("external_engine" IN ('NONE', 'ALONGSIDE', 'INSTEAD'))`,
    );
    await q.query(
      `ALTER TABLE "automation_change" ADD "requested_external_engine" character varying(10)`,
    );
    await q.query(
      `ALTER TABLE "automation_change" ADD "from_external_engine" character varying(10) NOT NULL DEFAULT 'NONE'`,
    );
    await q.query(
      `ALTER TABLE "automation_change" ALTER COLUMN "from_external_engine" DROP DEFAULT`,
    );
    await q.query(
      `ALTER TABLE "automation_change" ADD CONSTRAINT "CHK_automation_change_external_engine" CHECK (("kind" = 'SET_EXTERNAL_ENGINE') = ("requested_external_engine" IS NOT NULL))`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    // Forward-only once used (ADR 0022 amendment): reverting would drop the role of products
    // that call the external engine and the role changes in the automation history, and
    // RS-PL-4 records would name a step the schema no longer has. Refuse instead.
    const [{ records, changes, products }] = (await q.query(
      `SELECT (SELECT count(*)::int FROM "decision_record" WHERE "rule_set_version" = 'RS-PL-4') AS records,
              (SELECT count(*)::int FROM "automation_change" WHERE "kind" = 'SET_EXTERNAL_ENGINE') AS changes,
              (SELECT count(*)::int FROM "product_automation" WHERE "external_engine" <> 'NONE') AS products`,
    )) as [{ records: number; changes: number; products: number }];
    if (records > 0 || changes > 0 || products > 0) {
      throw new Error(
        `Cannot revert ExternalDecisionEngine: ${records} RS-PL-4 decision record(s), ${changes} external engine change(s) and ${products} product(s) using the engine would lose data. Reset the demo database instead.`,
      );
    }
    await q.query(
      `ALTER TABLE "automation_change" DROP CONSTRAINT "CHK_automation_change_external_engine"`,
    );
    await q.query(`ALTER TABLE "automation_change" DROP COLUMN "from_external_engine"`);
    await q.query(`ALTER TABLE "automation_change" DROP COLUMN "requested_external_engine"`);
    await q.query(
      `ALTER TABLE "product_automation" DROP CONSTRAINT "CHK_product_automation_external_engine"`,
    );
    await q.query(`ALTER TABLE "product_automation" DROP COLUMN "external_engine"`);
  }
}
