import type { DecisionMixReport, OriginationFunnelReport } from "@loan/core";
import { type Harness, readyForChecker, startHarness, submitCase } from "./support/harness";

/**
 * The reports run over this file's own data: the harness empties the case tables when it
 * starts, so the counts below are exact.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // Maria twice (auto-approve; one booked and disbursed), Joel (refer, counter-offer with an
  // override), Nico (refer, approved as requested), Ramon (auto-decline), and one draft.
  const maria = await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
  await readyForChecker(h, maria.id);
  await h.as("ella").post(`/cases/${maria.id}/booking/approve`).expect(200);
  await submitCase(h, { applicantId: "APL-MARIA", amount: "80000.00" });
  const joel = await submitCase(h, {
    applicantId: "APL-JOEL",
    amount: "200000.00",
    tenorMonths: 36,
  });
  await h
    .as("paolo")
    .post(`/cases/${joel.id}/recommendation`, {
      type: "COUNTER_OFFER",
      amount: "120000.00",
      tenorMonths: 36,
      overrideReason: "OV04",
      rationale: "Thin file: a smaller amount reduces exposure.",
    })
    .expect(200);
  const nico = await submitCase(h, { applicantId: "APL-NICO", amount: "50000.00" });
  await h
    .as("paolo")
    .post(`/cases/${nico.id}/recommendation`, {
      type: "APPROVE",
      rationale: "Obligations are falling; approve as requested.",
    })
    .expect(200);
  await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
  await submitCase(h, { applicantId: "APL-JOEL", amount: "50000.00", submit: false });
});
afterAll(async () => {
  await h.close();
});

/** Today's business date (Philippines, UTC+8). */
const businessDate = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("decision mix and origination funnel (PRD RPT-003, RPT-001)", () => {
  it("RPT-1 decision mix: outcomes, straight-through rate, reason codes, triggers and overrides", async () => {
    const r = (await h.as("rina").get("/reports/decision-mix").expect(200))
      .body as DecisionMixReport;
    expect(r.period).toEqual({ from: businessDate(-29), to: businessDate() });
    expect(r.decisions).toBe(5);
    expect(r.outcomes).toEqual([
      { key: "AUTO_APPROVE", count: 2, share: "0.4000" },
      { key: "REFER", count: 2, share: "0.4000" },
      { key: "AUTO_DECLINE", count: 1, share: "0.2000" },
    ]);
    expect(r.straightThroughRate).toBe("0.6000");
    expect(r.reasonCodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "R11", count: 1 })]),
    );
    expect(r.referralTriggers.reduce((n, t) => n + t.count, 0)).toBeGreaterThanOrEqual(2);
    expect(r).toMatchObject({
      recommendations: 2,
      overrides: 1,
      overrideRate: "0.5000",
      overrideReasons: [{ key: "OV04", count: 1, share: "1.0000" }],
    });
    // Nothing leaves the report but counts: no names, references or amounts.
    expect(JSON.stringify(r)).not.toMatch(/Maria|Joel|APP-\d|60000/);
  });

  it("RPT-2 funnel: started, submitted, approved, disbursed, with the disbursed amount and where cases sit", async () => {
    const r = (await h.as("diane").get("/reports/funnel").expect(200))
      .body as OriginationFunnelReport;
    expect(r.stages).toEqual([
      { key: "STARTED", count: 6, conversion: "1.0000" },
      { key: "SUBMITTED", count: 5, conversion: "0.8333" },
      { key: "APPROVED", count: 2, conversion: "0.4000" },
      { key: "DISBURSED", count: 1, conversion: "0.5000" },
    ]);
    expect(r.disbursedAmount).toBe("60000.00");
    expect(r.byStatus).toEqual(
      expect.arrayContaining([
        { key: "APPROVAL", count: 2, share: "0.3333" },
        { key: "DISBURSED", count: 1, share: "0.1667" },
        { key: "OFFER", count: 1, share: "0.1667" },
        { key: "DECLINED", count: 1, share: "0.1667" },
        { key: "DRAFT", count: 1, share: "0.1667" },
      ]),
    );
  });

  it("RPT-3 the period filters by business date; a period with nothing in it is all zeros", async () => {
    const yesterday = businessDate(-1);
    const r = (
      await h.as("leo").get(`/reports/funnel?from=${yesterday}&to=${yesterday}`).expect(200)
    ).body as OriginationFunnelReport;
    expect(r.stages.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    expect(r.disbursedAmount).toBe("0.00");
    const d = (
      await h.as("paolo").get(`/reports/decision-mix?from=${yesterday}&to=${yesterday}`).expect(200)
    ).body as DecisionMixReport;
    expect(d).toMatchObject({
      decisions: 0,
      straightThroughRate: "0.0000",
      overrideRate: "0.0000",
    });
  });

  it("RPT-4 roles and validation: officers, approvers, Compliance and the administrator read; others 403; bad periods 400", async () => {
    for (const persona of ["paolo", "rina", "diane", "leo"] as const) {
      await h.as(persona).get("/reports/decision-mix").expect(200);
      await h.as(persona).get("/reports/funnel").expect(200);
    }
    for (const persona of ["marco", "ella"] as const) {
      await h.as(persona).get("/reports/decision-mix").expect(403);
      await h.as(persona).get("/reports/funnel").expect(403);
    }
    await h.anonymous().get("/reports/funnel").expect(401);

    const backwards = await h
      .as("rina")
      .get(`/reports/funnel?from=${businessDate()}&to=${businessDate(-1)}`)
      .expect(400);
    expect(backwards.body.errors).toEqual([expect.objectContaining({ field: "to" })]);
    await h.as("rina").get("/reports/funnel?from=2026-02-31").expect(400);
    await h.as("rina").get("/reports/funnel?from=2024-01-01").expect(400);
    await h.as("rina").get("/reports/decision-mix?from=yesterday").expect(400);
    await h.as("rina").get("/reports/decision-mix?product=PL").expect(400);
  });

  it("RPT-5 a decision and an application dated before the period are left out while the others count", async () => {
    // Runs last: it adds a backdated decision record (insert-only, so a copy, 40 days back) and
    // moves the draft's start date back.
    const day40 = businessDate(-40);
    await h.ds.query(
      `INSERT INTO decision_record
         SELECT (jsonb_populate_record(NULL::decision_record, to_jsonb(d)
                  || jsonb_build_object('id', gen_random_uuid(), 'created_at', $1::timestamptz))).*
           FROM decision_record d WHERE d.outcome = 'AUTO_DECLINE' LIMIT 1`,
      [`${day40}T12:00:00+08:00`],
    );
    await h.ds.query("UPDATE loan_case SET created_at = $1::timestamptz WHERE status = 'DRAFT'", [
      `${day40}T12:00:00+08:00`,
    ]);

    const inPeriod = (await h.as("rina").get("/reports/decision-mix").expect(200))
      .body as DecisionMixReport;
    expect(inPeriod.decisions).toBe(5);
    const both = (
      await h.as("rina").get(`/reports/decision-mix?from=${day40}&to=${businessDate()}`).expect(200)
    ).body as DecisionMixReport;
    expect(both.decisions).toBe(6);
    expect(both.outcomes.find((o) => o.key === "AUTO_DECLINE")?.count).toBe(2);
    const onlyThatDay = (
      await h.as("rina").get(`/reports/decision-mix?from=${day40}&to=${day40}`).expect(200)
    ).body as DecisionMixReport;
    expect(onlyThatDay.decisions).toBe(1);

    const funnel = (await h.as("rina").get("/reports/funnel").expect(200))
      .body as OriginationFunnelReport;
    expect(funnel.stages[0]).toMatchObject({ key: "STARTED", count: 5 });
    const funnelBoth = (
      await h.as("rina").get(`/reports/funnel?from=${day40}&to=${businessDate()}`).expect(200)
    ).body as OriginationFunnelReport;
    expect(funnelBoth.stages[0]).toMatchObject({ key: "STARTED", count: 6 });
  });
});
