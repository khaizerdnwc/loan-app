import { AuditService } from "@loan/base";
import type { DecisionMixReport, OriginationFunnelReport, TurnaroundReport } from "@loan/core";
import { count, type Harness, startHarness, submitCase } from "./support/harness";

/** Report downloads as CSV (PRD RPT-006, downloads only), over this file's own data. */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await submitCase(h, { applicantId: "APL-MARIA", amount: "60000.00" });
  const joel = await submitCase(h, {
    applicantId: "APL-JOEL",
    amount: "200000.00",
    tenorMonths: 36,
  });
  // End one review visit (recommended on to an approver), so the turnaround has a REVIEW row
  // with a visit in it.
  await h
    .as("paolo")
    .post(`/cases/${joel.id}/recommendation`, {
      type: "APPROVE",
      rationale: "Reviewed: approve as requested.",
    })
    .expect(200);
  await submitCase(h, { applicantId: "APL-RAMON", amount: "50000.00" });
});
afterAll(async () => {
  await h.close();
});

/** Today's business date in Manila (UTC+8), and the date 29 days before it. */
const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const from = new Date(Date.now() + 8 * 3_600_000 - 29 * 86_400_000).toISOString().slice(0, 10);
const period = `?from=${from}&to=${today}`;

/** The audit log is never emptied, but nothing before this file downloads a report. */
const exports = async (staffId: string) =>
  (await h.ds.query(
    `SELECT summary, details FROM audit_event
      WHERE action = 'REPORT_EXPORTED' AND actor_id = $1 ORDER BY seq`,
    [staffId],
  )) as { summary: string; details: Record<string, unknown> }[];
const exportCount = () =>
  count(h.ds, "SELECT count(*) AS n FROM audit_event WHERE action = 'REPORT_EXPORTED'");

const lines = (text: string) => text.replace(/^﻿/, "").split("\r\n");

describe("report downloads as CSV (PRD RPT-006)", () => {
  it("EXP-1 the funnel downloads as a named, uncached CSV file with the report's own figures, and the download is audited", async () => {
    const json = (await h.as("rina").get(`/reports/funnel${period}`).expect(200))
      .body as OriginationFunnelReport;
    const res = await h.as("rina").get(`/reports/funnel.csv${period}`).expect(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="origination-funnel-${from}-to-${today}.csv"`,
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text.startsWith("﻿Report,Origination funnel\r\n")).toBe(true);
    const rows = lines(res.text);
    for (const s of json.stages) expect(rows).toContain(`${s.key},${s.count},${s.conversion}`);
    expect(rows).toContain(`Disbursed amount (PHP),${json.disbursedAmount}`);
    expect(json.stages.find((s) => s.key === "SUBMITTED")?.count).toBe(3);
    // Counts only: no applicant's name in the file.
    expect(res.text).not.toMatch(/Maria|Joel|Ramon/);

    expect(await exports("STF-RINA")).toEqual([
      {
        summary: `Downloaded the origination funnel for ${from} to ${today} as CSV.`,
        details: {
          report: "FUNNEL",
          from,
          to: today,
          fileName: `origination-funnel-${from}-to-${today}.csv`,
        },
      },
    ]);
  });

  it("EXP-1 the decision mix and the turnaround report download with the same figures as their screens", async () => {
    const mix = (await h.as("diane").get(`/reports/decision-mix${period}`).expect(200))
      .body as DecisionMixReport;
    const mixRes = await h.as("diane").get(`/reports/decision-mix.csv${period}`).expect(200);
    expect(mixRes.headers["content-disposition"]).toBe(
      `attachment; filename="decision-mix-${from}-to-${today}.csv"`,
    );
    const mixCsv = lines(mixRes.text);
    expect(mix.decisions).toBe(3);
    expect(mixCsv).toContain(`Decisions,${mix.decisions}`);
    expect(mixCsv).toContain(`Straight-through rate,${mix.straightThroughRate}`);
    for (const o of mix.outcomes) {
      expect(mixCsv).toContain(`${o.key},${o.label ?? ""},${o.count},${o.share}`);
    }

    const tat = (await h.as("leo").get(`/reports/turnaround${period}`).expect(200))
      .body as TurnaroundReport;
    const tatRes = await h.as("leo").get(`/reports/turnaround.csv${period}`).expect(200);
    expect(tatRes.headers["content-disposition"]).toBe(
      `attachment; filename="turnaround-sla-${from}-to-${today}.csv"`,
    );
    const tatCsv = lines(tatRes.text);
    expect(tatCsv).toContain(`Past SLA,${tat.openNow.breached}`);
    expect(tatCsv).toContain(`On track,${tat.openNow.onTrack}`);
    expect(tatCsv).toContain(`At risk,${tat.openNow.atRisk}`);
    // One stage row against the JSON report (a review stage always has its 8-hour SLA).
    const review = tat.stages.find((st) => st.status === "REVIEW");
    expect(review?.visits).toBeGreaterThanOrEqual(1);
    const cell = (v: number | string | null) => (v === null ? "" : String(v));
    expect(tatCsv).toContain(
      [
        "REVIEW",
        "In review",
        review?.visits,
        cell(review?.medianMinutes ?? null),
        cell(review?.p90Minutes ?? null),
        cell(review?.targetMinutes ?? null),
        review?.withinTarget,
        cell(review?.withinTargetShare ?? null),
      ].join(","),
    );

    expect(await exports("STF-DIANE")).toEqual([
      {
        summary: `Downloaded the decision mix for ${from} to ${today} as CSV.`,
        details: {
          report: "DECISION_MIX",
          from,
          to: today,
          fileName: `decision-mix-${from}-to-${today}.csv`,
        },
      },
    ]);
    expect(await exports("STF-LEO")).toEqual([
      {
        summary: `Downloaded the turnaround and SLA report for ${from} to ${today} as CSV.`,
        details: {
          report: "TURNAROUND",
          from,
          to: today,
          fileName: `turnaround-sla-${from}-to-${today}.csv`,
        },
      },
    ]);
  });

  it("EXP-2 the report readers only: loan operations 403, signed out 401, a bad period 400; none of them is audited", async () => {
    const before = await exportCount();
    for (const path of ["funnel.csv", "decision-mix.csv", "turnaround.csv"]) {
      await h.as("marco").get(`/reports/${path}${period}`).expect(403);
      await h.as("ella").get(`/reports/${path}${period}`).expect(403);
      await h.anonymous().get(`/reports/${path}${period}`).expect(401);
      const bad = await h.as("rina").get(`/reports/${path}?from=yesterday`).expect(400);
      expect(bad.body.code).toBe("VALIDATION_FAILED");
    }
    expect(await exportCount()).toBe(before);
  });

  it("EXP-2 a period that ends before it starts is 400 naming `to`, and is not audited", async () => {
    const before = await exportCount();
    const backwards = await h
      .as("rina")
      .get(`/reports/funnel.csv?from=${today}&to=${from}`)
      .expect(400);
    expect(backwards.body.errors).toEqual([expect.objectContaining({ field: "to" })]);
    expect(backwards.headers["content-disposition"]).toBeUndefined();
    expect(await exportCount()).toBe(before);
  });

  it("EXP-2 a download the audit log cannot record is refused (500): no file is handed out", async () => {
    const before = await exportCount();
    const audit = h.app.get(AuditService);
    const spy = jest
      .spyOn(audit, "record")
      .mockRejectedValueOnce(new Error("simulated audit store failure"));
    try {
      const res = await h.as("paolo").get(`/reports/funnel.csv${period}`).expect(500);
      expect(res.headers["content-disposition"]).toBeUndefined();
      expect(res.text).not.toContain("Origination funnel");
    } finally {
      spy.mockRestore();
    }
    expect(await exportCount()).toBe(before);
    // With the store back, the same download is recorded and served.
    await h.as("paolo").get(`/reports/funnel.csv${period}`).expect(200);
    expect(await exportCount()).toBe(before + 1);
  });
});
