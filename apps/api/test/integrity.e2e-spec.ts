import { randomUUID } from "node:crypto";
import { CasesRepository } from "@loan/base";
import {
  count,
  type Harness,
  resetData,
  startHarness,
  submitCase,
  truncateGuarded,
} from "./support/harness";

/**
 * H-7: foreign keys on the child tables, and TRUNCATE refused on the insert-only tables
 * (migration 1764300009000), with the test harness's reset still working around them.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

/**
 * The insert-only tables, from the catalogue: every table with a row-level refuse_change()
 * trigger. Derived rather than listed, so a new insert-only table without a TRUNCATE guard
 * fails these tests instead of slipping through.
 */
async function insertOnlyTables(): Promise<string[]> {
  const rows = (await h.ds.query(
    `SELECT DISTINCT tgrelid::regclass::text AS tbl FROM pg_trigger
     WHERE NOT tgisinternal AND tgfoid = 'refuse_change'::regproc AND (tgtype & 1) = 1
     ORDER BY 1`,
  )) as { tbl: string }[];
  return rows.map((r) => r.tbl);
}

/** Tables with a statement-level BEFORE TRUNCATE refuse_change() trigger. */
async function truncateGuardedTables(): Promise<string[]> {
  const rows = (await h.ds.query(
    `SELECT DISTINCT tgrelid::regclass::text AS tbl FROM pg_trigger
     WHERE NOT tgisinternal AND tgfoid = 'refuse_change'::regproc AND (tgtype & 32) = 32
       AND (tgtype & 1) = 0
     ORDER BY 1`,
  )) as { tbl: string }[];
  return rows.map((r) => r.tbl);
}

/** At least one row in every insert-only table, through the API where it writes them. */
async function populate(): Promise<void> {
  // Decisions, activity, consent, audit, and the provider calls the decision made.
  await submitCase(h, { applicantId: "APL-MARIA" });
  // A reconciliation run (loan operations supervisor).
  await h.as("ella").post("/operations/reconciliation/runs").expect(201);
  // Automation history: a requested change (it stays pending; one per product at a time).
  if ((await count(h.ds, "SELECT count(*) AS n FROM automation_event")) === 0) {
    await h
      .as("leo")
      .post("/automation/PL/changes", { kind: "SET_MODE", mode: "SHADOW", reason: "H-7 rows" })
      .expect(201);
  }
}

/** The Postgres error code a failed query carries (23503 foreign key, P0001 refuse_change). */
async function failure(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await h.ds.query(sql, params);
  } catch (err) {
    const e = err as { driverError?: { code?: string }; message?: string };
    return e.driverError?.code ?? e.message;
  }
  return undefined;
}

/** Every TRUNCATE guard and its enabled state ("O" = on). */
async function guards(): Promise<Record<string, string>> {
  const rows = (await h.ds.query(
    `SELECT tgrelid::regclass::text AS tbl, tgenabled AS enabled FROM pg_trigger
     WHERE NOT tgisinternal AND tgfoid = 'refuse_change'::regproc AND (tgtype & 32) = 32`,
  )) as { tbl: string; enabled: string }[];
  return Object.fromEntries(rows.map((r) => [r.tbl, r.enabled]));
}

const allOn = async () => Object.fromEntries((await insertOnlyTables()).map((t) => [t, "O"]));

describe("TRUNCATE is refused on the insert-only tables (H-7)", () => {
  it("every insert-only table (row-level refuse_change) also has a TRUNCATE guard", async () => {
    const insertOnly = await insertOnlyTables();
    // At least: decision_record, activity_event, consent_record, automation_event, audit_event,
    // reconciliation_run, provider_call.
    expect(insertOnly.length).toBeGreaterThanOrEqual(7);
    expect(await truncateGuardedTables()).toEqual(insertOnly);
  });

  it("TRUNCATE of each one is refused while it holds rows, and the rows stay", async () => {
    await populate();
    for (const table of await insertOnlyTables()) {
      const before = await count(h.ds, `SELECT count(*) AS n FROM ${table}`);
      expect({ table, hasRows: before > 0 }).toEqual({ table, hasRows: true });
      expect({ table, code: await failure(`TRUNCATE ${table} CASCADE`) }).toEqual({
        table,
        code: "P0001",
      });
      expect({ table, after: await count(h.ds, `SELECT count(*) AS n FROM ${table}`) }).toEqual({
        table,
        after: before,
      });
    }
  });

  it("the harness reset empties them and leaves every guard enabled afterwards", async () => {
    await populate();
    expect(await count(h.ds, "SELECT count(*) AS n FROM decision_record")).toBeGreaterThan(0);
    await resetData(h.ds);
    expect(await count(h.ds, "SELECT count(*) AS n FROM decision_record")).toBe(0);
    expect(await guards()).toEqual(await allOn());
    expect(await failure("TRUNCATE decision_record CASCADE")).toBe("P0001");
  });

  it("a reset that fails after disabling a guard rolls back: guards on, rows kept", async () => {
    await populate();
    const before = await count(h.ds, "SELECT count(*) AS n FROM decision_record");
    expect(before).toBeGreaterThan(0);
    // decision_record alone cannot be truncated (loan_case.decision_id references it), so the
    // TRUNCATE fails after its guard was disabled inside the transaction.
    await expect(truncateGuarded(h.ds, ["decision_record"])).rejects.toThrow(
      /referenced in a foreign key constraint/,
    );
    expect(await guards()).toEqual(await allOn());
    expect(await count(h.ds, "SELECT count(*) AS n FROM decision_record")).toBe(before);
  });
});

describe("foreign keys on the child tables (H-7)", () => {
  it("every child reference is a validated foreign key that cascades nothing (NO ACTION)", async () => {
    const rows = (await h.ds.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'f' AND convalidated
         AND confdeltype = 'a' AND confupdtype = 'a' AND conname = ANY($1)`,
      [
        [
          "FK_decision_record_case",
          "FK_activity_event_case",
          "FK_booking_request_case",
          "FK_loan_account_case",
          "FK_loan_account_booking_request",
          "FK_schedule_line_loan_account",
          "FK_disbursement_loan_account",
          "FK_loan_case_decision",
          "FK_consent_record_applicant",
          "FK_aml_escalation_applicant",
          "FK_provider_call_case",
        ],
      ],
    )) as { conname: string }[];
    expect(rows).toHaveLength(11);
  });

  it("refuses history for a case that does not exist", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const before = await count(h.ds, "SELECT count(*) AS n FROM activity_event");
    const err = await failure(
      `INSERT INTO activity_event (case_id, actor_id, actor_name, actor_role, action, summary, details)
       SELECT $1, actor_id, actor_name, actor_role, action, summary, details FROM activity_event
       WHERE case_id = $2 LIMIT 1`,
      [randomUUID(), c.id],
    );
    expect(err).toBe("23503");
    expect(await count(h.ds, "SELECT count(*) AS n FROM activity_event")).toBe(before);
  });

  it("refuses a case pointing at a decision that does not exist", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const err = await failure("UPDATE loan_case SET decision_id = $1 WHERE id = $2", [
      randomUUID(),
      c.id,
    ]);
    expect(err).toBe("23503");
    const [row] = (await h.ds.query("SELECT decision_id FROM loan_case WHERE id = $1", [c.id])) as {
      decision_id: string;
    }[];
    expect(row?.decision_id).toBe(c.decision?.id);
  });

  it("refuses deleting a case that has history (nothing cascades)", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    expect(await failure("DELETE FROM loan_case WHERE id = $1", [c.id])).toBe("23503");
    expect(await count(h.ds, "SELECT count(*) AS n FROM loan_case WHERE id = $1", [c.id])).toBe(1);
  });

  it("refuses consent for an applicant that does not exist", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const before = await count(h.ds, "SELECT count(*) AS n FROM consent_record");
    const err = await failure(
      `INSERT INTO consent_record (case_id, applicant_id, credit_bureau_check, data_processing,
         terms_version, channel, captured_by)
       VALUES ($1, 'APL-NOBODY', true, true, '1.0', 'BRANCH_ASSISTED', 'STF-PAOLO')`,
      [c.id],
    );
    expect(err).toBe("23503");
    expect(await count(h.ds, "SELECT count(*) AS n FROM consent_record")).toBe(before);
  });
});

/**
 * Run every cleanup step even when an earlier one throws (so a failed rollback never skips a
 * release and leaks a pooled connection), then rethrow the first failure.
 */
async function cleanup(...steps: Array<() => Promise<unknown>>): Promise<void> {
  let first: unknown;
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      first ??= err;
    }
  }
  if (first !== undefined) throw first;
}

describe("the case lock and foreign-key checks (H-7)", () => {
  it("while a case is locked, a provider call for it written on another connection does not wait", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const repo = h.app.get(CasesRepository);
    const holder = h.ds.createQueryRunner();
    const writer = h.ds.createQueryRunner();
    await holder.connect();
    await writer.connect();
    try {
      await holder.startTransaction();
      expect(await repo.lockCase(holder.manager, c.id)).not.toBeNull();
      // Another connection: the FK check takes FOR KEY SHARE on the case row. Under FOR UPDATE
      // it would wait for the holder (here: fail on the 2 s lock timeout); under FOR NO KEY
      // UPDATE it goes straight through. SET LOCAL ends with the writer's transaction, so the
      // timeout never stays on the pooled connection.
      await writer.startTransaction();
      await writer.query("SET LOCAL lock_timeout = '2s'");
      await writer.query(
        `INSERT INTO provider_call (service, operation, outcome, attempt, duration_ms, cost, case_id)
         VALUES ('CREDIT_BUREAU', 'H7_LOCK_TEST', 'OK', 1, 0, 0, $1)`,
        [c.id],
      );
      await writer.commitTransaction();
      expect(
        await count(
          h.ds,
          "SELECT count(*) AS n FROM provider_call WHERE operation = 'H7_LOCK_TEST'",
        ),
      ).toBe(1);
    } finally {
      await cleanup(
        async () => {
          if (writer.isTransactionActive) await writer.rollbackTransaction();
        },
        async () => {
          if (holder.isTransactionActive) await holder.rollbackTransaction();
        },
        () => writer.release(),
        () => holder.release(),
      );
    }
  });

  // A guard against weakening the lock too far (to a mode two lockers could share), not a
  // regression test for the FOR UPDATE → FOR NO KEY UPDATE change: it passes under both.
  it("the case lock still serialises two requests on the same case", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    const repo = h.app.get(CasesRepository);
    const holder = h.ds.createQueryRunner();
    const second = h.ds.createQueryRunner();
    await holder.connect();
    await second.connect();
    try {
      await holder.startTransaction();
      await second.startTransaction();
      await repo.lockCase(holder.manager, c.id);
      await second.query("SET LOCAL lock_timeout = '500ms'");
      await expect(repo.lockCase(second.manager, c.id)).rejects.toThrow(/lock timeout/);
    } finally {
      await cleanup(
        async () => {
          if (second.isTransactionActive) await second.rollbackTransaction();
        },
        async () => {
          if (holder.isTransactionActive) await holder.rollbackTransaction();
        },
        () => second.release(),
        () => holder.release(),
      );
    }
  });
});
