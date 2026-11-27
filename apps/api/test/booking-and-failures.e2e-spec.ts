import type { CaseDetail, LoanAccountView } from "@loan/core";
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

const accounts = (id: string) =>
  count(h.ds, "SELECT count(*) AS n FROM loan_account WHERE case_id = $1", [id]);
const coreAccounts = (id: string) =>
  count(h.ds, "SELECT count(*) AS n FROM sim.core_account WHERE application_id = $1", [id]);
const disbursements = (id: string) =>
  count(
    h.ds,
    "SELECT count(*) AS n FROM disbursement d JOIN loan_account a ON a.id = d.loan_account_id WHERE a.case_id = $1",
    [id],
  );
const payments = (id: string) =>
  count(
    h.ds,
    "SELECT count(*) AS n FROM sim.disbursement WHERE payload->>'loanAccountNumber' IN (SELECT core_account_number FROM loan_account WHERE case_id = $1)",
    [id],
  );

async function approvedCase(amount = "60000.00"): Promise<CaseDetail> {
  return submitCase(h, { applicantId: "APL-MARIA", amount, tenorMonths: 12 });
}

describe("booking integrity (ADR 0020)", () => {
  it("B-1 submitting a booking twice returns the same request and key", async () => {
    const c = await approvedCase();
    const first = await readyForChecker(h, c.id);
    const second = await h.as("marco").post(`/cases/${c.id}/booking`).expect(200);
    expect(second.body.booking.idempotencyKey).toBe(first.booking?.idempotencyKey);
    expect(
      await count(h.ds, "SELECT count(*) AS n FROM booking_request WHERE case_id = $1", [c.id]),
    ).toBe(1);
  });

  it("B-2 approving twice in sequence books once; the second call is refused", async () => {
    const c = await approvedCase();
    await readyForChecker(h, c.id);
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    const again = await h.as("lito").post(`/cases/${c.id}/booking/approve`).expect(409);
    expect(again.body.detail).toMatch(/already booked/);
    expect([
      await accounts(c.id),
      await coreAccounts(c.id),
      await disbursements(c.id),
      await payments(c.id),
    ]).toEqual([1, 1, 1, 1]);
  });

  it("B-3 checkers approving at the same moment book exactly once (raced on several cases)", async () => {
    // One race can finish before the other starts; several cases with three checker calls
    // each make an overlap inside the transaction near-certain, so the row lock is exercised.
    const cases = [];
    for (let i = 0; i < 5; i++) {
      const c = await approvedCase();
      await readyForChecker(h, c.id);
      cases.push(c);
    }
    // One case at a time: each race holds up to six connections (a locked case plus a
    // simulator call per checker), well inside the pool.
    const races = [];
    for (const c of cases) {
      races.push(
        await Promise.all([
          h.as("ella").post(`/cases/${c.id}/booking/approve`),
          h.as("lito").post(`/cases/${c.id}/booking/approve`),
          h.as("lito").post(`/cases/${c.id}/booking/approve`),
        ]),
      );
    }
    for (const [i, results] of races.entries()) {
      const id = (cases[i] as CaseDetail).id;
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect([
        await accounts(id),
        await coreAccounts(id),
        await disbursements(id),
        await payments(id),
      ]).toEqual([1, 1, 1, 1]);
    }
  });

  it("B-5 a core banking timeout leaves Booking failed with the error; the retry books once with the same key", async () => {
    const c = await approvedCase();
    const ready = await readyForChecker(h, c.id);
    await setMode(h, "CORE_BANKING", "TIMEOUT");
    const failed = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect(failed.body.code).toBe("PROVIDER_UNAVAILABLE");
    const view = (await h.as("ella").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(view).toMatchObject({
      status: "BOOKING_FAILED",
      booking: { status: "FAILED", attempts: 1, lastErrorCode: "PROVIDER_UNAVAILABLE" },
    });
    expect(view.allowedActions).toContainEqual({ action: "RETRY_BOOKING", enabled: true });
    expect(await accounts(c.id)).toBe(0);

    await setMode(h, "CORE_BANKING", "OK");
    const retried = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    expect(retried.body).toMatchObject({
      status: "DISBURSED",
      booking: { attempts: 2, idempotencyKey: ready.booking?.idempotencyKey },
    });
    expect([await accounts(c.id), await coreAccounts(c.id), await disbursements(c.id)]).toEqual([
      1, 1, 1,
    ]);
  });

  it("B-6 when core created the account but the reply was lost, the retry gets that same account", async () => {
    const c = await approvedCase();
    await readyForChecker(h, c.id);
    await setMode(h, "CORE_BANKING", "LOST_REPLY");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect([await coreAccounts(c.id), await accounts(c.id)]).toEqual([1, 0]);
    const [{ account_number: inCore }] = (await h.ds.query(
      "SELECT account_number FROM sim.core_account WHERE application_id = $1",
      [c.id],
    )) as [{ account_number: string }];

    await setMode(h, "CORE_BANKING", "OK");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    const account = (await h.as("ella").get(`/cases/${c.id}/loan-account`).expect(200))
      .body as LoanAccountView;
    expect(account.coreAccountNumber).toBe(inCore);
    expect([
      await coreAccounts(c.id),
      await accounts(c.id),
      await disbursements(c.id),
      await payments(c.id),
    ]).toEqual([1, 1, 1, 1]);
  });

  it("a disbursement outage after core booked also fails safely and the retry pays once", async () => {
    const c = await approvedCase();
    await readyForChecker(h, c.id);
    await setMode(h, "DISBURSEMENT", "OUTAGE");
    const failed = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect(failed.body.detail).toMatch(/disbursement service is unavailable/);
    expect([await coreAccounts(c.id), await accounts(c.id), await payments(c.id)]).toEqual([
      1, 0, 0,
    ]);
    await setMode(h, "DISBURSEMENT", "OK");
    await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(200);
    expect([await coreAccounts(c.id), await accounts(c.id), await payments(c.id)]).toEqual([
      1, 1, 1,
    ]);
  });

  it("a malformed core reply is refused and nothing is stored", async () => {
    const c = await approvedCase();
    await readyForChecker(h, c.id);
    await setMode(h, "CORE_BANKING", "MALFORMED");
    const failed = await h.as("ella").post(`/cases/${c.id}/booking/approve`).expect(503);
    expect(failed.body.detail).toMatch(/could not be read/);
    expect(await accounts(c.id)).toBe(0);
  });

  it("B-8 case status, decision record, loan account, schedule and disbursement agree for every disbursed case", async () => {
    // Its own disbursed case first, so the check never depends on the order of earlier tests.
    const own = await approvedCase();
    await readyForChecker(h, own.id);
    await h.as("ella").post(`/cases/${own.id}/booking/approve`).expect(200);

    const disbursed = await count(
      h.ds,
      "SELECT count(*) AS n FROM loan_case WHERE status = 'DISBURSED'",
    );
    const rows = (await h.ds.query(`
      SELECT c.id, c.approved_amount, c.approved_tenor_months, d.id AS decision_id, d.outcome,
             a.id AS account_id, a.principal, a.interest, a.total_repayable, a.tenor_months,
             (a.principal + a.interest)::text AS principal_plus_interest,
             (SELECT count(*) FROM schedule_line s WHERE s.loan_account_id = a.id) AS lines,
             (SELECT sum(s.amount)::text FROM schedule_line s WHERE s.loan_account_id = a.id) AS schedule_total,
             (SELECT sum(s.principal)::text FROM schedule_line s WHERE s.loan_account_id = a.id) AS schedule_principal,
             (SELECT sum(s.interest)::text FROM schedule_line s WHERE s.loan_account_id = a.id) AS schedule_interest,
             (SELECT x.amount FROM disbursement x WHERE x.loan_account_id = a.id) AS paid
      FROM loan_case c
      LEFT JOIN decision_record d ON d.id = c.decision_id
      LEFT JOIN loan_account a ON a.case_id = c.id
      WHERE c.status = 'DISBURSED'`)) as Record<string, string | number | null>[];
    expect(disbursed).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(disbursed);
    expect(rows.map((r) => r.id)).toContain(own.id);
    for (const r of rows) {
      expect(r.decision_id).not.toBeNull();
      expect(r.account_id).not.toBeNull();
      expect(r.principal).toBe(r.approved_amount);
      expect(r.total_repayable).toBe(r.principal_plus_interest);
      expect(Number(r.lines)).toBe(Number(r.tenor_months));
      expect(Number(r.tenor_months)).toBe(Number(r.approved_tenor_months));
      expect(r.schedule_total).toBe(r.total_repayable);
      expect(r.schedule_principal).toBe(r.principal);
      expect(r.schedule_interest).toBe(r.interest);
      expect(r.paid).toBe(r.principal);
      expect(["AUTO_APPROVE", "REFER"]).toContain(r.outcome);
    }
  });
});

describe("outages degrade to referral, never decline (B-7, PRD NFR-005)", () => {
  it.each(["OUTAGE", "TIMEOUT", "MALFORMED"])(
    "B-7 with the bureau in %s, a submission is referred with R10",
    async (mode) => {
      await setMode(h, "CREDIT_BUREAU", mode);
      const c = await submitCase(h, {
        applicantId: "APL-MARIA",
        amount: "60000.00",
        tenorMonths: 12,
      });
      expect(c).toMatchObject({ status: "REVIEW", outcome: "REFER" });
      expect(c.decision?.score).toBeNull();
      expect(c.decision?.reasonCodes.map((r) => r.code)).toEqual(["R10"]);
    },
  );

  it("with KYC/AML screening down, a submission is referred with R13", async () => {
    await setMode(h, "KYC_AML", "OUTAGE");
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "60000.00",
      tenorMonths: 12,
    });
    expect(c).toMatchObject({ status: "REVIEW", outcome: "REFER" });
    expect(c.decision?.reasonCodes.map((r) => r.code)).toContain("R13");
  });

  it("a knockout still declines while the bureau is down (Ramon, sanctions)", async () => {
    await setMode(h, "CREDIT_BUREAU", "OUTAGE");
    const c = await submitCase(h, {
      applicantId: "APL-RAMON",
      amount: "50000.00",
      tenorMonths: 12,
    });
    expect(c).toMatchObject({ status: "DECLINED", outcome: "AUTO_DECLINE" });
    expect(c.decision?.reasonCodes.map((r) => r.code)).toEqual(["R11"]);
  });

  it("e-signature outage leaves the case in Offer and says so", async () => {
    const c = await approvedCase();
    await setMode(h, "E_SIGNATURE", "OUTAGE");
    const res = await h.as("marco").post(`/cases/${c.id}/sign`).expect(503);
    expect(res.body.code).toBe("PROVIDER_UNAVAILABLE");
    expect((await h.as("marco").get(`/cases/${c.id}`).expect(200)).body.status).toBe("OFFER");
  });
});

describe("decision records", () => {
  it("are insert-only in the database", async () => {
    await approvedCase();
    await expect(h.ds.query("UPDATE decision_record SET score = 800")).rejects.toThrow(
      /insert-only/,
    );
    await expect(h.ds.query("DELETE FROM activity_event")).rejects.toThrow(/insert-only/);
  });

  it("every seeded persona decides as docs/ASSUMPTIONS.md says", async () => {
    const expected: [string, string, string, number | null][] = [
      ["APL-MARIA", "150000.00", "AUTO_APPROVE", 742],
      ["APL-JOEL", "200000.00", "REFER", 612],
      ["APL-RAMON", "50000.00", "AUTO_DECLINE", null],
      ["APL-NICO", "250000.00", "REFER", 602],
      ["APL-RAFAEL", "500000.00", "REFER", 757],
      ["APL-CARMEN", "60000.00", "AUTO_DECLINE", 450],
      ["APL-KEVIN", "40000.00", "AUTO_DECLINE", null],
      ["APL-NINA", "80000.00", "REFER", 537],
    ];
    for (const [applicantId, amount, outcome, score] of expected) {
      const c = await submitCase(h, { applicantId, amount, tenorMonths: 24 });
      expect([applicantId, c.outcome, c.decision?.score ?? null]).toEqual([
        applicantId,
        outcome,
        score,
      ]);
    }
  });
});
