import type { CaseDetail, CaseSummary } from "@loan/core";
import { type Harness, setMode, startHarness, submitCase } from "./support/harness";

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

/** Joel (grade C, referred) with a ₱120,000 / 36-month counter-offer in front of the approver. */
async function inApproval(): Promise<CaseDetail> {
  const c = await submitCase(h, { applicantId: "APL-JOEL", amount: "200000.00", tenorMonths: 36 });
  expect(c.status).toBe("REVIEW");
  expect(c.proposedRepayment).toBeNull();
  const res = await h
    .as("paolo")
    .post(`/cases/${c.id}/recommendation`, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV04",
      rationale: "Thin file.",
    })
    .expect(200);
  return res.body as CaseDetail;
}

describe("the queue's Reason column (U-9)", () => {
  it("U-9 a case summary carries the first referral trigger of a referred case, the first reason of an automatic decline, and null for a draft", async () => {
    const referred = await submitCase(h, {
      applicantId: "APL-JOEL",
      amount: "200000.00",
      tenorMonths: 36,
    });
    expect(referred.status).toBe("REVIEW");
    const list = (await h.as("paolo").get("/cases?view=all").expect(200)).body as {
      items: CaseSummary[];
    };
    const row = list.items.find((i) => i.id === referred.id);
    expect(row?.reason).toBe(referred.decision?.referralTriggers[0]);
    expect(row?.reason).toBeTruthy();
    // Joel is referred for a thin file and a score in the referral band: two triggers.
    expect(row?.reasonCount).toBe(referred.decision?.referralTriggers.length);
    expect(row?.reasonCount).toBeGreaterThan(1);

    const draft = (
      await h
        .as("paolo")
        .post("/cases", {
          applicantId: "APL-LIZA",
          amount: "50000.00",
          tenorMonths: 12,
          purpose: "Repairs",
          submit: false,
        })
        .expect(201)
    ).body as CaseDetail;
    const again = (await h.as("paolo").get("/cases?view=all").expect(200)).body as {
      items: CaseSummary[];
    };
    expect(again.items.find((i) => i.id === draft.id)).toMatchObject({
      reason: null,
      reasonCount: 0,
    });
  });

  it("U-9 an automatic decline's summary carries its first reason in staff words", async () => {
    const declined = await submitCase(h, {
      applicantId: "APL-RAMON",
      amount: "90000.00",
      tenorMonths: 12,
    });
    expect(declined.status).toBe("DECLINED");
    const list = (await h.as("paolo").get("/cases?view=all").expect(200)).body as {
      items: CaseSummary[];
    };
    expect(list.items.find((i) => i.id === declined.id)).toMatchObject({
      reason: declined.decision?.reasonCodes[0]?.staff,
      reasonCount: declined.decision?.reasonCodes.length,
    });
  });
});

describe("the repayment being approved (U-8, prototype approve dialog)", () => {
  it("U-8 while awaiting approval, the case carries core's quote for the recommended terms at the case's grade; it is exactly the instalment the approval then records", async () => {
    const c = await inApproval();
    expect(c.status).toBe("APPROVAL");
    const seen = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(seen.proposedRepayment).toMatchObject({
      status: "QUOTED",
      amount: "120000.00",
      tenorMonths: 36,
      grade: "C",
      monthlyRate: "0.0160",
      providerMode: "SIMULATED",
    });
    expect(seen.proposedRepayment?.regularInstalment).toMatch(/^\d+\.\d{2}$/);

    const approved = (await h.as("rina").post(`/cases/${c.id}/approve`).expect(200))
      .body as CaseDetail;
    expect(approved.status).toBe("OFFER");
    expect(approved.proposedRepayment).toBeNull();
    expect(approved.approved?.regularInstalment).toBe(seen.proposedRepayment?.regularInstalment);
  });

  it("U-8 when core banking is down the case still opens, the quote says UNAVAILABLE, and the approval still works", async () => {
    const c = await inApproval();
    await setMode(h, "CORE_BANKING", "OUTAGE");
    const seen = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(seen.proposedRepayment).toMatchObject({
      status: "UNAVAILABLE",
      regularInstalment: null,
    });
    const approved = (await h.as("rina").post(`/cases/${c.id}/approve`).expect(200))
      .body as CaseDetail;
    expect(approved.status).toBe("OFFER");
    // The approval records the terms and the grade's rate; the instalment core could not
    // quote stays unknown rather than guessed.
    expect(approved.approved).toMatchObject({
      amount: "120000.00",
      tenorMonths: 36,
      monthlyRate: "0.0160",
      regularInstalment: null,
    });
    expect(approved.approved?.by).toBeTruthy();
    expect(approved.proposedRepayment).toBeNull();
  });

  it("U-8 the quote uses the case's own grade and rate, not the indicative grade C (grade A at 1.20%)", async () => {
    // Maria scores in the approve band (grade A) but asks above the automatic approval
    // limit, so she is referred and recommended as requested.
    const c = await submitCase(h, {
      applicantId: "APL-MARIA",
      amount: "400000.00",
      tenorMonths: 24,
    });
    expect(c.status).toBe("REVIEW");
    expect(c.grade).toBe("A");
    await h
      .as("paolo")
      .post(`/cases/${c.id}/recommendation`, { type: "APPROVE", rationale: "Strong file." })
      .expect(200);
    const seen = (await h.as("rina").get(`/cases/${c.id}`).expect(200)).body as CaseDetail;
    expect(seen.proposedRepayment).toMatchObject({
      status: "QUOTED",
      amount: "400000.00",
      tenorMonths: 24,
      grade: "A",
      monthlyRate: "0.0120",
    });
    // 400,000 × 1.20% × 24 = 115,200 interest: 515,200 repayable in total.
    expect(seen.proposedRepayment?.totalRepayable).toBe("515200.00");
    const approved = (await h.as("rina").post(`/cases/${c.id}/approve`).expect(200))
      .body as CaseDetail;
    expect(approved.approved?.monthlyRate).toBe("0.0120");
    expect(approved.approved?.regularInstalment).toBe(seen.proposedRepayment?.regularInstalment);
  });
});
