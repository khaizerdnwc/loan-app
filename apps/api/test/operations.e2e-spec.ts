import { AuditService } from "@loan/base";
import type {
  BookingExceptionView,
  CaseDetail,
  LatestReconciliationView,
  ReconciliationFinding,
  ReconciliationRunSummaryView,
  ReconciliationRunView,
} from "@loan/core";
import {
  count,
  type Harness,
  readyForChecker,
  setMode,
  startHarness,
  submitCase,
} from "./support/harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});
afterEach(async () => {
  await h.ds.query("TRUNCATE sim.service_mode");
});

const keyOf = async (caseId: string) =>
  (
    (await h.ds.query("SELECT idempotency_key FROM booking_request WHERE case_id = $1", [
      caseId,
    ])) as { idempotency_key: string }[]
  )[0]?.idempotency_key as string;
const runs = () => count(h.ds, "SELECT count(*) AS n FROM reconciliation_run");
const audits = () => count(h.ds, "SELECT count(*) AS n FROM audit_event");
const payments = (key: string) =>
  count(h.ds, "SELECT count(*) AS n FROM sim.disbursement WHERE idempotency_key = $1", [key]);

async function runReconciliation(): Promise<ReconciliationRunView> {
  return (await h.as("ella").post("/operations/reconciliation/runs").expect(201))
    .body as ReconciliationRunView;
}

const findingFor = (run: ReconciliationRunView, key: string): ReconciliationFinding | undefined =>
  run.findings.find((f) => f.idempotencyKey === key);

/** An approved Maria twin at the checker step. */
async function atChecker(): Promise<CaseDetail> {
  const c = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00", tenorMonths: 12 });
  await readyForChecker(h, c.id);
  return c;
}

describe("booking exceptions and reconciliation (PRD BKG-005)", () => {
  it("REC-1 a failed booking is listed for loan operations and Compliance, with its key and error", async () => {
    const c = await atChecker();
    await setMode(h, "CORE_BANKING", "TIMEOUT");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    const key = await keyOf(c.id);

    for (const persona of ["marco", "ella", "diane"] as const) {
      const list = (await h.as(persona).get("/operations/exceptions").expect(200))
        .body as BookingExceptionView[];
      expect(list.find((e) => e.caseId === c.id)).toMatchObject({
        caseReference: c.reference,
        applicantName: "Maria Santos",
        amount: "60000.00",
        idempotencyKey: key,
        attempts: 1,
        lastError: expect.stringMatching(/did not answer in time/),
        blockedReason: null,
      });
    }
    for (const persona of ["paolo", "rina", "leo"] as const) {
      await h.as(persona).get("/operations/exceptions").expect(403);
    }
    await h.anonymous().get("/operations/exceptions").expect(401);

    // Booked on retry: it leaves the list.
    await setMode(h, "CORE_BANKING", "OK");
    await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(200);
    const after = (await h.as("ella").get("/operations/exceptions").expect(200))
      .body as BookingExceptionView[];
    expect(after.some((e) => e.caseId === c.id)).toBe(false);
  });

  it("REC-2 a lost reply leaves an open, undisbursed core account; a retry refused by the checklist keeps it so, and the run finds it", async () => {
    const c = await atChecker();
    const key = await keyOf(c.id);
    await setMode(h, "CORE_BANKING", "LOST_REPLY");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    await setMode(h, "CORE_BANKING", "OK");
    // The checklist then refuses the retry (the deposit account is no longer WhiteBank's).
    await h.ds.query(
      "UPDATE applicant SET deposit_account = 'EXT-0000' WHERE id = (SELECT applicant_id FROM loan_case WHERE id = $1)",
      [c.id],
    );
    const refused = await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(refused.body.code).toBe("BOOKING_CHECKLIST_INCOMPLETE");
    expect(await payments(key)).toBe(0);

    const run = await runReconciliation();
    expect(findingFor(run, key)).toMatchObject({
      kind: "CORE_ACCOUNT_UNDISBURSED",
      caseId: c.id,
      caseReference: c.reference,
      lendingAccountNumber: null,
      coreAmount: "60000.00",
    });
    const listed = (
      (await h.as("ella").get("/operations/exceptions").expect(200)).body as BookingExceptionView[]
    ).find((e) => e.caseId === c.id);
    expect(listed).toMatchObject({
      reconciliation: "CORE_ACCOUNT_UNDISBURSED",
      blockedReason: expect.stringMatching(/Pre-booking checklist: Disbursement account/),
    });
  });

  it("REC-3 a payment made but not recorded is found; the retry with the same key records it and the next run matches", async () => {
    const c = await atChecker();
    const key = await keyOf(c.id);
    // The rail pays, then its reply cannot be read: lending records nothing.
    await setMode(h, "DISBURSEMENT", "MALFORMED");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    await setMode(h, "DISBURSEMENT", "OK");
    expect(await payments(key)).toBe(1);
    expect(findingFor(await runReconciliation(), key)).toMatchObject({
      kind: "CORE_ACCOUNT_PAID_UNRECORDED",
    });

    await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(200);
    expect(await payments(key)).toBe(1);
    const run = await runReconciliation();
    expect(findingFor(run, key)).toBeUndefined();
    expect(run.summary.matched).toBeGreaterThanOrEqual(1);
  });

  it("REC-4 core and the rail disagreeing with lending: missing, different account, different payment, orphans", async () => {
    const booked = async () => {
      const c = await atChecker();
      await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
      return keyOf(c.id);
    };
    const gone = await booked();
    const changed = await booked();
    const paidOther = await booked();
    await h.ds.query("DELETE FROM sim.core_account WHERE idempotency_key = $1", [gone]);
    await h.ds.query(
      `UPDATE sim.core_account SET payload = jsonb_set(payload, '{principal}', '"60000.01"')
        WHERE idempotency_key = $1`,
      [changed],
    );
    await h.ds.query(
      `UPDATE sim.disbursement SET payload = jsonb_set(payload, '{amount}', '"59999.99"')
        WHERE idempotency_key = $1`,
      [paidOther],
    );
    await h.ds.query(
      `INSERT INTO sim.core_account (idempotency_key, account_number, application_id, payload)
       VALUES ('bk-unknown-1', 'LN-2026-999999', 'app-unknown',
               '{"accountNumber":"LN-2026-999999","principal":"1000.00","interest":"0.00","totalRepayable":"1000.00","openedAt":"2026-11-28T00:00:00.000Z","schedule":[]}')`,
    );
    const snapshot = async () => ({
      accounts: await count(h.ds, "SELECT count(*) AS n FROM loan_account"),
      bookings: await count(h.ds, "SELECT count(*) AS n FROM booking_request"),
      payments: await count(h.ds, "SELECT count(*) AS n FROM sim.disbursement"),
      coreAccounts: await count(h.ds, "SELECT count(*) AS n FROM sim.core_account"),
      statuses: (await h.ds.query("SELECT id, status FROM loan_case ORDER BY id")) as unknown[],
    });
    const lendingBefore = await snapshot();
    const run = await runReconciliation();
    expect(findingFor(run, gone)?.kind).toBe("LENDING_ACCOUNT_MISSING_IN_CORE");
    expect(findingFor(run, changed)).toMatchObject({
      kind: "ACCOUNT_MISMATCH",
      coreAmount: "60000.01",
      lendingAmount: "60000.00",
    });
    expect(findingFor(run, paidOther)?.kind).toBe("PAYMENT_MISMATCH");
    expect(findingFor(run, "bk-unknown-1")).toMatchObject({
      kind: "ORPHAN",
      caseId: null,
      coreAccountNumber: "LN-2026-999999",
    });
    // Reconciliation reads; it changes no case, account or payment.
    expect(await snapshot()).toEqual(lendingBefore);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM sim.core_account WHERE idempotency_key = $1", [
        gone,
      ]),
    ).toBe(0);
  });

  it("REC-5 each run is stored insert-only with an audit entry; Compliance reads but cannot run", async () => {
    const before = { runs: await runs(), audits: await audits() };
    const run = await runReconciliation();
    expect(run).toMatchObject({ runByName: "Ella Reyes", providerMode: "SIMULATED" });
    expect(await runs()).toBe(before.runs + 1);
    expect(await audits()).toBe(before.audits + 1);
    const [entry] = (await h.ds.query(
      "SELECT action, details FROM audit_event ORDER BY seq DESC LIMIT 1",
    )) as { action: string; details: { runId: string } }[];
    expect(entry).toMatchObject({ action: "RECONCILIATION_RUN", details: { runId: run.id } });

    const latest = (await h.as("diane").get("/operations/reconciliation/latest").expect(200))
      .body as LatestReconciliationView;
    expect(latest.run?.id).toBe(run.id);
    const history = (await h.as("marco").get("/operations/reconciliation/runs").expect(200))
      .body as ReconciliationRunSummaryView[];
    expect(history[0]?.id).toBe(run.id);

    await h.as("diane").post("/operations/reconciliation/runs").expect(403);
    for (const persona of ["paolo", "rina", "leo"] as const) {
      await h.as(persona).post("/operations/reconciliation/runs").expect(403);
      await h.as(persona).get("/operations/reconciliation/latest").expect(403);
      await h.as(persona).get("/operations/reconciliation/runs").expect(403);
    }
    await h.anonymous().post("/operations/reconciliation/runs").expect(401);
    expect(await runs()).toBe(before.runs + 1);

    await expect(
      h.ds.query("UPDATE reconciliation_run SET run_by = 'x' WHERE id = $1", [run.id]),
    ).rejects.toThrow(/insert-only/);
    await expect(
      h.ds.query("DELETE FROM reconciliation_run WHERE id = $1", [run.id]),
    ).rejects.toThrow(/insert-only/);
    expect(await runs()).toBe(before.runs + 1);
  });

  it("REC-8 the run and its audit entry commit together: an audit failure records no run", async () => {
    const before = { runs: await runs(), audits: await audits() };
    const audit = h.app.get(AuditService);
    const real = audit.append.bind(audit);
    const spy = jest
      .spyOn(audit, "append")
      .mockImplementation((m, input) =>
        input.action === "RECONCILIATION_RUN"
          ? Promise.reject(new Error("simulated audit store failure"))
          : real(m, input),
      );
    try {
      await h.as("ella").post("/operations/reconciliation/runs").expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await runs()).toBe(before.runs);
    expect(await audits()).toBe(before.audits);
    await runReconciliation();
    expect(await runs()).toBe(before.runs + 1);
  });

  it("REC-9 a booking held for Compliance is listed as blocked, with the hold as the reason", async () => {
    const c = await submitCase(h, {
      applicantId: "APL-DARIO",
      amount: "60000.00",
      tenorMonths: 12,
    });
    await readyForChecker(h, c.id);
    const res = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(res.body.code).toBe("SCREENING_MATCH");
    const listed = (
      (await h.as("marco").get("/operations/exceptions").expect(200)).body as BookingExceptionView[]
    ).find((e) => e.caseId === c.id);
    expect(listed).toMatchObject({
      attempts: 1,
      blockedReason: expect.stringMatching(/^Held for Compliance/),
    });
  });

  it("REC-6 a feed that cannot answer records no run (503), and nothing changes", async () => {
    for (const [service, mode] of [
      ["CORE_BANKING", "OUTAGE"],
      ["DISBURSEMENT", "TIMEOUT"],
      ["CORE_BANKING", "MALFORMED"],
    ] as const) {
      await setMode(h, service, mode);
      const before = { runs: await runs(), audits: await audits() };
      const res = await h.as("ella").post("/operations/reconciliation/runs").expect(503);
      expect(res.body).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(res.body.detail).toMatch(/nothing was reconciled/);
      expect(await runs()).toBe(before.runs);
      expect(await audits()).toBe(before.audits);
      await setMode(h, service, "OK");
    }
  });
});
